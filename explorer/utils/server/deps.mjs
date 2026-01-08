function toError(value) {
  return value instanceof Error ? value : new Error(String(value));
}

export async function loadZodToJsonSchema({ recordFatalError }) {
  try {
    const { zodToJsonSchema } = await import('zod-to-json-schema');
    return zodToJsonSchema;
  } catch (error) {
    const moduleError = toError(error);
    recordFatalError?.('module-import:zod-to-json-schema', moduleError);
    return () => {
      throw moduleError;
    };
  }
}

export async function loadFilesystemDeps({ recordFatalError }) {
  let normalizePath;
  let expandHome;
  let getValidRootDirectories;
  let formatSize;
  let validatePath;
  let getFileStats;
  let readFileContent;
  let writeFileContent;
  let searchFilesWithValidation;
  let applyFileEdits;
  let tailFile;
  let headFile;
  let setAllowedDirectories;

  try {
    const pathUtils = await import('@modelcontextprotocol/server-filesystem/dist/path-utils.js');
    ({ normalizePath, expandHome } = pathUtils);
    const rootsUtils = await import('@modelcontextprotocol/server-filesystem/dist/roots-utils.js');
    ({ getValidRootDirectories } = rootsUtils);
    const lib = await import('@modelcontextprotocol/server-filesystem/dist/lib.js');
    ({
      formatSize,
      validatePath,
      getFileStats,
      readFileContent,
      writeFileContent,
      searchFilesWithValidation,
      applyFileEdits,
      tailFile,
      headFile,
      setAllowedDirectories
    } = lib);
  } catch (error) {
    const moduleError = toError(error);
    recordFatalError?.('module-import:@modelcontextprotocol/server-filesystem', moduleError);
    const syncThrow = () => { throw moduleError; };
    const asyncThrow = async () => { throw moduleError; };
    normalizePath = syncThrow;
    expandHome = syncThrow;
    getValidRootDirectories = asyncThrow;
    formatSize = syncThrow;
    validatePath = asyncThrow;
    getFileStats = asyncThrow;
    readFileContent = asyncThrow;
    writeFileContent = asyncThrow;
    searchFilesWithValidation = asyncThrow;
    applyFileEdits = asyncThrow;
    tailFile = asyncThrow;
    headFile = asyncThrow;
    setAllowedDirectories = syncThrow;
  }

  return {
    normalizePath,
    expandHome,
    getValidRootDirectories,
    formatSize,
    validatePath,
    getFileStats,
    readFileContent,
    writeFileContent,
    searchFilesWithValidation,
    applyFileEdits,
    tailFile,
    headFile,
    setAllowedDirectories
  };
}
