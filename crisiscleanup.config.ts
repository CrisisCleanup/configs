import process from "node:process";
import path from "node:path";
import { exec } from "node:child_process";
import fs from "node:fs/promises";

// load from where c12/jiti lives.
const requireFromParentProc = (moduleId: string) =>
  require(require.resolve(moduleId, { paths: [process.cwd()] }));

const destr = requireFromParentProc("destr");
const defu = requireFromParentProc("defu").default;

// pwd will be parent process
const configsRelative = (...pathParts: string[]) =>
  path.resolve(__dirname, ...pathParts);

async function decrypt(filePath: string): Promise<Record<string, unknown>> {
  const args = ["sops", "-d", filePath];
  return new Promise((resolve, reject) => {
    exec(args.join(" "), (error, stdout, stderr) => {
      if (error) reject(error);
      if (stderr) reject(new Error(stderr));
      resolve(destr.destr(stdout.trim()));
    });
  });
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

const commonDefaults = {
  apiStack: {
    codeStarConnectionArn:
      "arn:aws:codestar-connections:us-east-1:971613762022:connection/fa675d04-034e-445d-8918-5e4cf2ca8899",
  },
};

interface ConfigSources {
  name: string;
  configPath: string;
  secretsPath: string;
}

function resolveSources(name: string): ConfigSources {
  const configPath = configsRelative("api", `${name}.json`);
  const parts = path.parse(configPath);
  const envName = parts.name;
  const secretsPath = path.format({
    root: parts.root,
    dir: parts.dir,
    ext: ".secrets" + parts.ext,
    name: parts.name,
  });
  return {
    name: envName,
    configPath,
    secretsPath,
  };
}

async function resolveConfig(
  sources: ConfigSources,
  autoDecrypt: boolean = false
) {
  const { configPath, secretsPath, name } = sources;
  const [configData, secretsData] = await Promise.all([
    pathExists(configPath).then(async (exists) => {
      if (!exists) return {};
      return (await import(configPath)).default;
    }),
    pathExists(secretsPath).then(async (exists) => {
      if (!exists) return {};
      if (!autoDecrypt) return {};
      return await decrypt(secretsPath);
    }),
  ]);
  return [name, defu(configData, secretsData, commonDefaults)];
}

async function main() {
  const autoDecrypt = Boolean(destr.destr(process.env.CCU_CONFIGS_DECRYPT));
  const stages = ["local", "development", "staging", "production", "test"];
  const sources = stages.map((stage) => resolveSources(stage));
  const envConfigs = await Promise.all(
    sources.map((source) => resolveConfig(source, autoDecrypt))
  );
  return {
    $meta: { name: "crisiscleanup", repo: "configs", sources },
    $env: Object.fromEntries(envConfigs),
    ...commonDefaults,
  };
}

export default main;
