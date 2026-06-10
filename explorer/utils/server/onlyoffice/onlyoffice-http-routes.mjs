export function createOnlyOfficeHttpHandler() {
  return async function handleOnlyOfficeHttpRequest() {
    return false;
  };
}
