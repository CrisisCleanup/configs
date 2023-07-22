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

async function resolveConfig(configPath: string) {
  const parts = path.parse(configPath);
  const envName = parts.name;
  const secretsPath = path.format({
    root: parts.root,
    dir: parts.dir,
    ext: ".secrets" + parts.ext,
    name: parts.name,
  });
  const [configData, secretsData] = await Promise.all([
    pathExists(configPath).then(async (exists) => {
      if (!exists) return {};
      return (await import(configPath)).default;
    }),
    pathExists(secretsPath).then(async (exists) => {
      if (!exists) return {};
      return await decrypt(secretsPath);
    }),
  ]);
  return [envName, defu(configData, secretsData)];
}

async function main() {
  const stages = ["local", "development", "staging", "production", "test"];
  const envConfigs = await Promise.all(
    stages.map((stage) =>
      resolveConfig(configsRelative("api", `${stage}.json`))
    )
  );
  return {
    $meta: { name: "crisiscleanup" },
    $env: Object.fromEntries(envConfigs),
  };
}

export default main;
