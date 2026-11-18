const fs = require('fs');
const path = require('path');

const srcDir = path.resolve(__dirname, '..', 'frontend', 'dist');
const destDir = path.resolve(__dirname, '..', 'dist');

if (!fs.existsSync(srcDir)) {
  console.error('frontend/dist does not exist! Run frontend build first.');
  process.exit(1);
}

// 1. Copy frontend/dist to ./dist
fs.cpSync(srcDir, destDir, { recursive: true });
console.log('✓ Copied frontend/dist to root ./dist');

const indexHtmlPath = path.join(destDir, 'index.html');
if (fs.existsSync(indexHtmlPath)) {
  // 2. Generate dist/404.html (Render and other static hosts serve 404.html on unmatched routes)
  fs.copyFileSync(indexHtmlPath, path.join(destDir, '404.html'));
  console.log('✓ Generated dist/404.html for SPA fallback');

  // 3. Pre-generate subdirectories with index.html for known routes
  const routes = [
    'login',
    'register',
    'admin',
    'admin/login',
    'admin/dashboard',
    'employee',
    'employee/dashboard',
    'employee/attendance',
    'employee/leave',
    'employee/profile',
    'employee/chat',
    'hr',
    'hr/login',
    'hr/dashboard',
    'hr-projects',
    'hr-projects/login',
    'teamlead',
    'teamlead/login',
    'teamlead/register',
    'teamlead/dashboard',
  ];

  for (const route of routes) {
    const routeDir = path.join(destDir, route);
    fs.mkdirSync(routeDir, { recursive: true });
    fs.copyFileSync(indexHtmlPath, path.join(routeDir, 'index.html'));
  }
  console.log(`✓ Pre-generated ${routes.length} static route folders with index.html`);
}

// 4. Ensure dist/_redirects exists
const redirectsPath = path.join(destDir, '_redirects');
fs.writeFileSync(redirectsPath, '/*    /index.html   200\n', 'utf8');
console.log('✓ Generated dist/_redirects');

