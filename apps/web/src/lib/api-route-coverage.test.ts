import { readdirSync, readFileSync, statSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';
import { describe, expect, test } from 'vitest';

const webRoot = process.cwd();
const sourceRoot = resolve(webRoot, 'src');

function filesBelow(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = resolve(directory, name);
    if (statSync(path).isDirectory()) {
      if (['.git', '.next', 'coverage', 'node_modules'].includes(name)) return [];
      return filesBelow(path);
    }
    return [path];
  });
}

function normalizeRoute(route: string): string {
  return route
    .split('?')[0]
    .replace(/\$\{[^}]+\}/g, ':param')
    .replace(/\[\.\.\.([^\]]+)\]/g, ':$1*')
    .replace(/\[([^\]]+)\]/g, ':$1')
    .replace(/\/$/, '');
}

function registeredRoutes(): string[] {
  const routes: string[] = [];
  const appApiRoot = resolve(sourceRoot, 'app/api');
  for (const file of filesBelow(appApiRoot)) {
    if (!/\/route\.(ts|tsx)$/.test(file)) continue;
    const route = relative(appApiRoot, file)
      .replaceAll(sep, '/')
      .replace(/\/route\.(ts|tsx)$/, '')
      .split('/')
      .map((segment) =>
        segment.replace(/^\[\.\.\.([^\]]+)\]$/, ':$1*').replace(/^\[([^\]]+)\]$/, ':$1'),
      )
      .join('/');
    routes.push(normalizeRoute(`/api/${route}`));
  }

  const pagesApiRoot = resolve(sourceRoot, 'pages/api');
  for (const file of filesBelow(pagesApiRoot)) {
    if (!/\.(ts|tsx|js|jsx)$/.test(file)) continue;
    const route = relative(pagesApiRoot, file)
      .replaceAll(sep, '/')
      .replace(/\.(ts|tsx|js|jsx)$/, '')
      .split('/')
      .map((segment) =>
        segment.replace(/^\[\.\.\.([^\]]+)\]$/, ':$1*').replace(/^\[([^\]]+)\]$/, ':$1'),
      )
      .join('/');
    routes.push(normalizeRoute(`/api/${route}`));
  }
  return routes;
}

function clientApiTargets(): Array<{ file: string; target: string }> {
  return filesBelow(webRoot)
    .filter((file) => /\.(ts|tsx|js|jsx)$/.test(file))
    .filter((file) => !file.includes(`${sep}src${sep}app${sep}api${sep}`))
    .filter((file) => !file.includes(`${sep}src${sep}pages${sep}api${sep}`))
    .filter((file) => !/\.(test|spec|stories)\./.test(file))
    .filter((file) => !file.endsWith(`${sep}src${sep}proxy.ts`))
    .flatMap((file) => {
      const source = readFileSync(file, 'utf8');
      const targets = [
        ...source.matchAll(/(?:fetch|EventSource)\s*\(\s*'([^']*\/api\/[^']*)'/g),
        ...source.matchAll(/(?:fetch|EventSource)\s*\(\s*"([^"]*\/api\/[^"]*)"/g),
        ...source.matchAll(/(?:fetch|EventSource)\s*\(\s*`([^`]*\/api\/[^`]*)`/g),
        ...source.matchAll(/useSWR(?:<[^()]*>)?\s*\(\s*['"`]([^'"`]*\/api\/[^'"`]*)['"`]/g),
      ].map((match) => match[1]);
      return targets.map((target) => ({ file: relative(webRoot, file), target }));
    });
}

function matchesRoute(target: string, route: string): boolean {
  const targetParts = normalizeRoute(target).split('/').filter(Boolean);
  const routeParts = route.split('/').filter(Boolean);
  return (
    targetParts.length === routeParts.length &&
    targetParts.every(
      (part, index) => routeParts[index].startsWith(':') || part === routeParts[index],
    )
  );
}

describe('client API route coverage', () => {
  test('every client API target has a registered Next route handler', () => {
    const routes = registeredRoutes();
    const missing = clientApiTargets().filter(
      ({ target }) => !routes.some((route) => matchesRoute(target, route)),
    );

    expect(missing).toEqual([]);
  });
});
