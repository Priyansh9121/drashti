// Node-only contract tests use the same TypeScript source as Electron; resolve Bundler's extensionless imports.
export async function resolve(specifier, context, nextResolve) {
  try { return await nextResolve(specifier, context); }
  catch (error) {
    if (error.code !== 'ERR_MODULE_NOT_FOUND' || !specifier.startsWith('.') || /\.[a-z]+$/u.test(specifier)) throw error;
    return nextResolve(`${specifier}.ts`, context);
  }
}
