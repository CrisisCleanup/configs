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
  pipeline: {
    repositories: [
      "infrastructure",
      "configs",
      "crisiscleanup-3-api",
      "crisiscleanup-4-web",
      "maintenance-site",
      "au-offline-site",
      "test-reports",
    ],
    appRegistryTag:
      "arn:aws:resource-groups:us-east-1:240937704012:group/CrisisCleanup/0562syncluzmzrexfmht044qum",
  },
  api: {
    config: {
      rag: {
        chatModel: "gpt-4o",
      },
      sentry: {
        traceExcludeUrls: [
          "/",
          "/health",
          "/health/",
          "/ws/health",
          "/ws/health/",
          "/version",
          "/version/",
          "/{var}health/",
          "/{var}version/",
          "crisiscleanup.common.tasks.get_request_ip",
          "crisiscleanup.common.tasks.create_signal_log",
          "crisiscleanup.common.tasks.create_new_signal_events",
          "/users/{pk}/states",
        ],
      },
    },
  },
  apiStack: {
    database: {
      // todo: Cut this down to what we know we need
      bastionAllowList: [
        "73.169.88.227/32",
        "142.126.162.104/32",
        "161.97.247.185/32",
        "174.211.225.161/32",
        "174.231.69.141/32",
        "174.211.229.24/32",
        "174.212.48.78/32",
        "174.247.150.192/32",
        "75.104.68.120/32",
        "174.211.103.239/32",
        "38.126.149.170/32",
        "72.209.64.197/32",
        "205.197.214.20/32",
        "4.35.4.130/32",
        "174.211.227.236/32",
        "142.126.171.42/32",
        "205.197.214.19/32",
        "71.44.210.146/32",
        "99.77.124.108/32",
        "50.236.237.36/32",
        "170.222.128.10/32",
        "174.211.235.50/32",
        "174.211.236.77/32",
        "129.222.86.238/32",
        "184.146.17.249/32",
        "161.97.206.242/32",
        "174.247.153.24/32",
        "142.126.183.191/32",
        "104.3.145.144/32",
        "174.211.235.39/32",
        "174.211.235.32/32",
        "174.211.178.193/32",
        "174.211.233.209/32",
        "161.97.247.158/32",
        "102.89.45.95/32",
        "68.98.142.231/32",
        // staging->dev sync
        "107.23.81.184/32",
        "52.207.16.112/32",
        // prod->staging sync
        "34.225.76.94/32",
        "34.230.206.171/32",
        "44.218.173.117/32",
        "165.0.103.204/32"
      ],
    },
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
  autoDecrypt: boolean = false,
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
  const stages = [
    "local",
    "development",
    "staging",
    "production",
    "production-au",
    "test",
  ];
  const sources = stages.map((stage) => resolveSources(stage));
  const envConfigs = await Promise.all(
    sources.map((source) => resolveConfig(source, autoDecrypt)),
  );
  return {
    $meta: { name: "crisiscleanup", repo: "configs", sources },
    $env: Object.fromEntries(envConfigs),
    ...commonDefaults,
  };
}

export default main;
