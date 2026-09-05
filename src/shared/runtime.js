export function hasExtensionRuntime(extensionApi) {
  return typeof extensionApi?.runtime?.sendMessage === 'function';
}
