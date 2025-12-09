const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '.env');

try {
    let content = fs.readFileSync(envPath, 'utf8');
    const lines = content.split(/\r?\n/);

    const newLines = lines.map(line => {
        if (line.trim().startsWith('DATABASE_URL')) {
            const parts = line.split('=');
            if (parts.length >= 2) {
                let key = parts[0].trim();
                let value = parts.slice(1).join('=').trim();

                // Strip leading/trailing quotes (single or double)
                if ((value.startsWith("'") && value.endsWith("'")) ||
                    (value.startsWith('"') && value.endsWith('"'))) {
                    value = value.slice(1, -1);
                }

                // Strip ANY remaining quotes just in case (aggressive)
                // Actually, quotes inside correct URL? No.
                // But let's act strict: remove ' and " from the start/end only, recursively
                while ((value.startsWith("'") || value.startsWith('"'))) value = value.substring(1);
                while ((value.endsWith("'") || value.endsWith('"'))) value = value.substring(0, value.length - 1);

                return `${key}="${value}"`; // Wrap in clean double quotes
            }
        }
        return line;
    });

    fs.writeFileSync(envPath, newLines.join('\n'));
    console.log("Aggressively cleaned .env DATABASE_URL");

} catch (err) {
    console.error("Error fixing .env:", err);
}
