const fs = require('fs');
const path = require('path');

function getJsonFiles(dir, fileList = []) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    if (file === '.git' || file === 'node_modules') continue;
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      getJsonFiles(filePath, fileList);
    } else if (file.endsWith('.json') && file !== 'files.json' && file !== 'package.json') {
      const relativePath = path.relative(__dirname, filePath);
      fileList.push(relativePath);
    }
  }
  return fileList;
}

const jsonFiles = getJsonFiles(__dirname).sort();
fs.writeFileSync(path.join(__dirname, 'files.json'), JSON.stringify(jsonFiles, null, 2));
console.log(`Generated files.json with ${jsonFiles.length} files.`);
