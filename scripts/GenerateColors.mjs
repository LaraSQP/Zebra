import fs from "node:fs";

const packagePath = new URL( "../package.json", import.meta.url );

// Read the existing package manifest
const packageJson = JSON.parse( fs.readFileSync( packagePath, "utf8" ) );

// Generate the contributed theme colors
const colors = [];

for( const prefix of [ "color", "auto" ] )
{
	for( let i = 1; i <= 32; i++ )
	{
		colors.push( {
			id: `zebra.${prefix}${i}`,
			description: `Zebra ${prefix === "auto" ? "automatic " : ""}color slot ${i}`,
			defaults: {
				dark: "#ff0011",
				light: "#ff0011",
				highContrast: "#ff0011",
				highContrastLight: "#ff0011",
			},
		} );
	}
}

// Replace the existing color declarations
packageJson.contributes.colors = colors;

// Save the updated manifest
fs.writeFileSync(
	packagePath,
	JSON.stringify( packageJson, null, "\t" ) + "\n",
	"utf8",
);

console.log( "Zebra: Generated 64 theme color declarations" );