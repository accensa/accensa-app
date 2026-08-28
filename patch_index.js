import fs from 'fs';

const path = 'apps/docs/src/pages/index.tsx';
let content = fs.readFileSync(path, 'utf8');

const conflict = `<<<<<<< HEAD
  const {siteConfig} = useDocusaurusContext();
=======
  const { siteConfig } = useDocusaurusContext();
>>>>>>> origin/main`;

content = content.replace(conflict, '  const { siteConfig } = useDocusaurusContext();');

fs.writeFileSync(path, content);
