const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '.env');

try {
    let content = fs.readFileSync(envPath, 'utf8');

    // Check if DATABASE_URL exists
    if (content.includes('DATABASE_URL')) {
        // Regex to match DATABASE_URL line
        // We want to remove single quotes surrounding the value
        content = content.replace(/DATABASE_URL=['"]?(postgresql:\/\/[^'"\n]+)['"]?/g, "DATABASE_URL=\"$1\"");

        // Also ensure no trailing/leading whitespace or weird chars in the hostname part if possible
        // But the main culprit is usually '...'.

        fs.writeFileSync(envPath, content);
        console.log("Fixed .env formatting for DATABASE_URL");
    } else {
        console.log("DATABASE_URL not found in .env");
    }

} catch (err) {
    console.error("Error fixing .env:", err);
}
