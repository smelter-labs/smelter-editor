const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '..');

const config = getDefaultConfig(projectRoot);

// Include workspace root so Metro can watch workspace packages (e.g. @smelter-editor/types).
// pnpm symlinks workspace deps into mobile_app/node_modules, so Metro can follow them.
config.watchFolders = [workspaceRoot];

// Resolve modules from mobile_app first, then the workspace root.
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

module.exports = config;
