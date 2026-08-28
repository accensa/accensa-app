import fs from 'fs';

const path = 'pnpm-workspace.yaml';
let content = fs.readFileSync(path, 'utf8');

const conflict = `<<<<<<< HEAD
  sharp: true
=======
  sharp: false
>>>>>>> origin/main`;

content = content.replace(conflict, '  sharp: true');

fs.writeFileSync(path, content);
