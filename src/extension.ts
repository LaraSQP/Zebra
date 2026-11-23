import * as vscode from "vscode";

// Maximum number of automatically assigned colors
const MAX_COLORS = 32;

// Activate Zebra
export async function activate( context: vscode.ExtensionContext )
{
	// Copy the selected file names to the clipboard
	const CopyFilename = async ( uri: vscode.Uri, resourceUris?: vscode.Uri[] ) =>
	{
		// Use all selected resources, falling back to the single resource
		const selectedUris = resourceUris?.length ? resourceUris : uri ? [ uri ] : [];

		// Collect the names of all selected files and folders
		const filenames = selectedUris.map( ( selectedUri ) => selectedUri.path.split( "/" ).pop() ?? "" );

		// Copy the names to the clipboard, one per line
		await vscode.env.clipboard.writeText( filenames.join( "\n" ) );
	};

	context.subscriptions.push(
		vscode.commands.registerCommand( "zebra.copyFilename", CopyFilename ),
		vscode.commands.registerCommand( "zebra.copyFilenames", CopyFilename )
	);

	// Get Zebra's configuration
	const config = vscode.workspace.getConfiguration( "zebra" );

	// Initialize the example configuration when no Zebra folder settings exist
	async function InitializeConfiguration(): Promise<void>
	{
		// There is nowhere to store workspace-specific settings without a workspace
		if( ( vscode.workspace.workspaceFolders === undefined )
			|| ( vscode.workspace.workspaceFolders.length === 0 ) )
		{
			return;
		}

		// Check whether Zebra's folder settings have already been configured
		const foldersSetting = config.inspect<Record<string, string>>( "folders" );

		const hasFolders = ( foldersSetting?.globalValue !== undefined )
			|| ( foldersSetting?.workspaceValue !== undefined )
			|| ( foldersSetting?.workspaceFolderValue !== undefined );

		// Add the example settings only when no folder configuration exists
		if( hasFolders === false )
		{
			await config.update( "folders", {
				"exampleFolder": "zebra.color1"
			}, vscode.ConfigurationTarget.Workspace );

			// Get the existing Workbench color customizations
			const workbenchConfig = vscode.workspace.getConfiguration( "workbench" );
			const existing        = workbenchConfig.get<Record<string, unknown>>( "colorCustomizations", {} );

			// Add the example color only when it has not already been defined
			if( existing[ "zebra.color1" ] === undefined )
			{
				const updated             = { ...existing };
				updated[ "zebra.color1" ] = "#8cb4d5";

				await workbenchConfig.update( "colorCustomizations", updated, vscode.ConfigurationTarget.Workspace );
			}
		}
	}

	// Initialize the example configuration
	await InitializeConfiguration();

	// Read the folder-to-color dictionary
	let folders = vscode.workspace.getConfiguration( "zebra" ).get<Record<string, string>>( "folders", {} );

	// Map each configured hex color to one of Zebra's automatic theme color IDs
	let colorSlots = new Map<string, string>();

	// Create an event emitter to notify VS Code when decorations change
	const decorationChanged = new vscode.EventEmitter<vscode.Uri | vscode.Uri[] | undefined>();

	// Update the automatic theme color slots from the current configuration
	async function UpdateColorSlots(): Promise<void>
	{
		// There is nowhere to store workspace-specific colors without a workspace
		if( ( vscode.workspace.workspaceFolders === undefined )
			|| ( vscode.workspace.workspaceFolders.length === 0 ) )
		{
			return;
		}

		// Create a new map for the current set of automatic slots
		const nextSlots = new Map<string, string>();

		// Collect the automatic theme color customizations Zebra needs
		const zebraColors: Record<string, string> = {};

		// Assign an automatic slot to each distinct configured hex color
		for( const value of Object.values( folders ) )
		{
			// Ignore values that are not direct six-digit hex colors
			if( /^#[0-9A-Fa-f]{6}$/.test( value ) === false )
			{
				continue;
			}

			// Normalize the hex value so differently cased values share one slot
			const normalizedHex = value.toUpperCase();

			// Reuse the slot if this color has already been assigned
			if( nextSlots.has( normalizedHex ) === true )
			{
				continue;
			}

			// Stop if all available automatic slots have been assigned
			if( nextSlots.size >= MAX_COLORS )
			{
				console.warn( `Zebra supports a maximum of ${MAX_COLORS} automatic colors` );
				break;
			}

			// Create the next automatic theme color ID
			const slotId = `zebra.auto${nextSlots.size + 1}`;

			// Associate the hex value with its automatic theme color ID
			nextSlots.set( normalizedHex, slotId );

			// Prepare the corresponding Workbench color customization
			zebraColors[ slotId ] = normalizedHex;
		}

		// Get the Workbench configuration
		const workbenchConfig = vscode.workspace.getConfiguration( "workbench" );

		// Inspect the existing workspace-level color customizations
		const inspected = workbenchConfig.inspect<Record<string, unknown>>( "colorCustomizations" );

		// Preserve existing workspace customizations
		const existing = inspected?.workspaceFolderValue ?? inspected?.workspaceValue ?? {};

		// Create a separate object so the original settings are not modified
		const updated: Record<string, unknown> = { ...existing };

		// Remove the previous Zebra automatic color assignments
		for( let i = 1; i <= MAX_COLORS; i++ )
		{
			delete updated[ `zebra.auto${i}` ];
		}

		// Add the current Zebra automatic color assignments
		Object.assign( updated, zebraColors );

		// Check whether the customizations have actually changed
		const changed = JSON.stringify( existing ) !== JSON.stringify( updated );

		// Avoid creating an empty workbench.colorCustomizations setting
		if( changed === false )
		{
			colorSlots = nextSlots;
			decorationChanged.fire( undefined );
			return;
		}

		try
		{
			// Save the automatic color assignments to workspace settings
			await workbenchConfig.update( "colorCustomizations", updated, vscode.ConfigurationTarget.Workspace );

			// Make the new automatic slot assignments available to the decoration provider
			colorSlots = nextSlots;

			// Tell VS Code to request the decorations again
			decorationChanged.fire( undefined );

			// Log the assigned colors for diagnostics
			if( context.extensionMode === vscode.ExtensionMode.Development )
			{
				console.log( "Zebra automatic color slots:", Object.fromEntries( colorSlots ) );
				console.log( "Zebra color customizations:", zebraColors );
			}
		} catch( error )
		{
			// Report an error if the workspace settings could not be updated
			console.error( "Zebra could not update Workbench color customizations:", error );
		}
	}

	// Create the file decoration provider
	const provider: vscode.FileDecorationProvider = {
		// Expose the event so VS Code can listen for decoration changes
		onDidChangeFileDecorations: decorationChanged.event,

		// Provide a decoration for a file or folder
		provideFileDecoration( uri: vscode.Uri ): vscode.FileDecoration | undefined
		{
			// Find the workspace folder containing this resource
			const workspaceFolder = vscode.workspace.getWorkspaceFolder( uri );

			// Ignore resources outside the workspace
			if( workspaceFolder === undefined )
			{
				return undefined;
			}

			// Get the path relative to the workspace root
			const relativePath = vscode.workspace.asRelativePath( uri, false )
				.replace( /\\/g, "/" )
				.replace( /^\.\/+/, "" )
				.replace( /\/+$/, "" );

			// Keep track of the best matching color rule
			let bestColor: string | undefined;
			let bestScore = -1;

			// Check every configured folder and path
			for( const [ key, value ] of Object.entries( folders ) )
			{
				// Normalize the configured path
				const folderPath = key.replace( /\\/g, "/" ).replace( /^\/+|\/+$/g, "" );

				// Ignore empty configuration keys
				if( folderPath === "" )
				{
					continue;
				}

				// Ignore values that are neither hex colors nor manual color IDs
				if( ( /^#[0-9A-Fa-f]{6}$/.test( value ) === false )
					&& ( /^zebra\.color([1-9]|[12][0-9]|3[0-2])$/.test( value ) === false ) )
				{
					continue;
				}

				// Check whether this is a full relative path or a folder name
				if( folderPath.includes( "/" ) === true )
				{
					// Match the exact path and all its descendants
					if( ( relativePath === folderPath )
						|| ( relativePath.startsWith( folderPath + "/" ) === true ) )
					{
						// Prefer the longest matching path
						const score = 100000 + folderPath.length;

						// Keep the most specific matching rule
						if( score > bestScore )
						{
							bestScore = score;
							bestColor = value;
						}
					}
				} else
				{
					// Match a folder name anywhere in the relative path
					if( relativePath.split( "/" ).includes( folderPath ) === true )
					{
						// Folder-name matches have lower priority than full paths
						if( bestScore < 1 )
						{
							bestScore = 1;
							bestColor = value;
						}
					}
				}
			}

			// Return no decoration if there is no matching color rule
			if( bestColor === undefined )
			{
				return undefined;
			}

			// Use a manual theme color ID directly when one was configured
			const manualSlot = /^zebra\.color([1-9]|[12][0-9]|3[0-2])$/.test( bestColor )
				? bestColor
				: undefined;

			// Otherwise, find the automatic slot assigned to the hex color
			const automaticSlot = /^#[0-9A-Fa-f]{6}$/.test( bestColor )
				? colorSlots.get( bestColor.toUpperCase() )
				: undefined;

			// Select the appropriate theme color ID
			const slotId = manualSlot ?? automaticSlot;

			// Return no decoration if the color has no available slot
			if( slotId === undefined )
			{
				return undefined;
			}

			// Return the decoration using the selected theme color
			return new vscode.FileDecoration( undefined, undefined, new vscode.ThemeColor( slotId ) );
		}
	};

	// Register the provider with VS Code
	context.subscriptions.push( vscode.window.registerFileDecorationProvider( provider ) );

	// Listen for changes to Zebra's folder settings
	context.subscriptions.push( vscode.workspace.onDidChangeConfiguration( ( event ) =>
	{
		// Ignore configuration changes unrelated to Zebra's folders
		if( event.affectsConfiguration( "zebra.folders" ) === false )
		{
			return;
		}

		// Read the updated Zebra configuration
		const updatedConfig = vscode.workspace.getConfiguration( "zebra" );
		folders             = updatedConfig.get<Record<string, string>>( "folders", {} );

		// Reassign the theme color slots
		void UpdateColorSlots();
	} ) );

	// Initialize Zebra when a workspace is opened after activation
	context.subscriptions.push( vscode.workspace.onDidChangeWorkspaceFolders( () =>
	{
		void InitializeConfiguration().then( () =>
		{
			// Read the current Zebra configuration
			const updatedConfig = vscode.workspace.getConfiguration( "zebra" );
			folders             = updatedConfig.get<Record<string, string>>( "folders", {} );

			// Reassign the theme color slots
			return UpdateColorSlots();
		} );
	} ) );

	// Refresh folder decorations when workspace trust is granted
	context.subscriptions.push( vscode.workspace.onDidGrantWorkspaceTrust( () =>
	{
		// Read the current Zebra configuration
		const updatedConfig = vscode.workspace.getConfiguration( "zebra" );
		folders             = updatedConfig.get<Record<string, string>>( "folders", {} );

		// Reassign the theme color slots
		void UpdateColorSlots();
	} ) );

	// Register the event emitter for automatic cleanup
	context.subscriptions.push( decorationChanged );

	// Assign the initial theme color slots
	await UpdateColorSlots();
}

// Deactivate Zebra
export function deactivate() { }
