import * as vscode from "vscode";

// Maximum number of automatically assigned colors
const MAX_COLORS = 32;

// Activate Zebra
export function activate(context: vscode.ExtensionContext) {
	// Copy the selected file's name to the clipboard
	context.subscriptions.push(
		vscode.commands.registerCommand(
			"zebra.copyFilename",
			async (uri: vscode.Uri) => {
				const filename = uri.path.split("/").pop() ?? "";
				await vscode.env.clipboard.writeText(filename);
			},
		),
	);

	// Get Zebra's configuration
	const config = vscode.workspace.getConfiguration("zebra");

	// Read the folder-to-color dictionary
	let colors = config.get<Record<string, string>>("colors", {});

	// Map each configured hex color to one of Zebra's automatic theme color IDs
	let colorSlots = new Map<string, string>();

	// Create an event emitter to notify vsCode when decorations change
	const decorationChanged = new vscode.EventEmitter<
		vscode.Uri | vscode.Uri[] | undefined
	>();

	// Update the automatic theme color slots from the current configuration
	async function UpdateColorSlots(): Promise<void> {
		// There is nowhere to store workspace-specific colors without a workspace
		if (!vscode.workspace.workspaceFolders?.length) {
			return;
		}

		// Create a new map for the current set of colors
		const nextSlots = new Map<string, string>();

		// Collect the automatic color customizations Zebra needs
		const zebraColors: Record<string, string> = {};

		// Assign a slot to each distinct configured hex color
		for (const value of Object.values(colors)) {
			// Ignore values that are not six-digit hex colors
			if (!/^#[0-9A-Fa-f]{6}$/.test(value)) {
				continue;
			}

			// Normalize the hex value so differently cased values share one slot
			const normalizedHex = value.toUpperCase();

			// Reuse the slot if this color has already been assigned
			if (nextSlots.has(normalizedHex)) {
				continue;
			}

			// Stop if all available automatic slots have been assigned
			if (nextSlots.size >= MAX_COLORS) {
				console.warn(
					`Zebra supports a maximum of ${MAX_COLORS} automatic colors`,
				);
				break;
			}

			// Create the next automatic theme color ID
			const slotId = `zebra.auto${nextSlots.size + 1}`;

			// Associate the hex value with its automatic theme color ID
			nextSlots.set(normalizedHex, slotId);

			// Prepare the corresponding workbench color customization
			zebraColors[slotId] = normalizedHex;
		}

		// Get the Workbench configuration
		const workbenchConfig = vscode.workspace.getConfiguration("workbench");

		// Inspect the existing workspace-level color customizations
		const inspected = workbenchConfig.inspect<Record<string, unknown>>(
			"colorCustomizations",
		);

		// Preserve existing workspace customizations
		const existing =
			inspected?.workspaceFolderValue ?? inspected?.workspaceValue ?? {};

		// Create a separate object so the original settings are not modified
		const updated: Record<string, unknown> = { ...existing };

		// Remove the previous Zebra automatic color assignments
		for (let i = 1; i <= MAX_COLORS; i++) {
			delete updated[`zebra.auto${i}`];
		}

		// Add the current Zebra automatic color assignments
		Object.assign(updated, zebraColors);

		try {
			// Save the automatic color assignments to the workspace settings
			await workbenchConfig.update(
				"colorCustomizations",
				updated,
				vscode.ConfigurationTarget.Workspace,
			);

			// Make the new slot assignments available to the decoration provider
			colorSlots = nextSlots;

			// Tell vsCode to request the decorations again
			decorationChanged.fire(undefined);

			// Log the assigned automatic colors for diagnostics
			if (context.extensionMode === vscode.ExtensionMode.Development) {
				console.log(
					"Zebra automatic color slots:",
					Object.fromEntries(colorSlots),
				);
			}
		} catch (error) {
			// Report an error if the workspace settings could not be updated
			console.error(
				"Zebra could not update workbench color customizations:",
				error,
			);
		}
	}

	// Create the file decoration provider
	const provider: vscode.FileDecorationProvider = {
		// Expose the event so vsCode can listen for decoration changes
		onDidChangeFileDecorations: decorationChanged.event,

		// Provide a decoration for a file or folder
		provideFileDecoration(
			uri: vscode.Uri,
		): vscode.FileDecoration | undefined {
			// Find the workspace folder containing this resource
			const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);

			// Ignore resources outside the workspace
			if (!workspaceFolder) {
				return undefined;
			}

			// Get the path relative to the workspace root
			const relativePath = vscode.workspace
				.asRelativePath(uri, false)
				.replace(/\\/g, "/")
				.replace(/^\.\/+/, "")
				.replace(/\/+$/, "");

			// Keep track of the best matching color rule
			let bestColor: string | undefined;
			let bestScore = -1;

			// Check every configured folder and path
			for (const [key, value] of Object.entries(colors)) {
				// Normalize the configured path
				const folderPath = key
					.replace(/\\/g, "/")
					.replace(/^\/+|\/+$/g, "");

				// Ignore empty configuration keys
				if (!folderPath) {
					continue;
				}

				// Ignore values that are neither hex colors nor manual color IDs
				if (
					!/^#[0-9A-Fa-f]{6}$/.test(value) &&
					!/^zebra\.color([1-9]|[12][0-9]|3[0-2])$/.test(value)
				) {
					continue;
				}

				// Check whether this is a full relative path or a folder name
				if (folderPath.includes("/")) {
					// Match the exact path and all its descendants
					if (
						relativePath === folderPath ||
						relativePath.startsWith(folderPath + "/")
					) {
						// Prefer the longest matching path
						const score = 100000 + folderPath.length;

						// Keep the most specific matching rule
						if (score > bestScore) {
							bestScore = score;
							bestColor = value;
						}
					}
				} else {
					// Match a folder name anywhere in the relative path
					if (relativePath.split("/").includes(folderPath)) {
						// Folder-name matches have lower priority than full paths
						if (bestScore < 1) {
							bestScore = 1;
							bestColor = value;
						}
					}
				}
			}

			// Return no decoration if there is no matching color rule
			if (!bestColor) {
				return undefined;
			}

			// Use a manual theme color ID directly when one was configured
			const manualSlot = /^zebra\.color([1-9]|[12][0-9]|3[0-2])$/.test(
				bestColor,
			)
				? bestColor
				: undefined;

			// Otherwise, find the automatic slot assigned to the hex color
			const automaticSlot = colorSlots.get(bestColor.toUpperCase());

			// Select the appropriate theme color ID
			const slotId = manualSlot ?? automaticSlot;

			// Return no decoration if the color has no available slot
			if (!slotId) {
				return undefined;
			}

			// Return the decoration using the selected theme color
			return new vscode.FileDecoration(
				undefined,
				undefined,
				new vscode.ThemeColor(slotId),
			);
		},
	};

	// Register the provider with vsCode
	context.subscriptions.push(
		vscode.window.registerFileDecorationProvider(provider),
	);

	// Listen for changes to Zebra's color settings
	context.subscriptions.push(
		vscode.workspace.onDidChangeConfiguration((event) => {
			// Ignore configuration changes unrelated to Zebra's colors
			if (!event.affectsConfiguration("zebra.colors")) {
				return;
			}

			// Read the updated folder-to-color dictionary
			colors = vscode.workspace
				.getConfiguration("zebra")
				.get<Record<string, string>>("colors", {});

			// Reassign the automatic theme color slots
			void UpdateColorSlots();
		}),
	);

	// Register the event emitter for automatic cleanup
	context.subscriptions.push(decorationChanged);

	// Assign the initial automatic color slots
	void UpdateColorSlots();
}

// Deactivate Zebra
export function deactivate() {}
