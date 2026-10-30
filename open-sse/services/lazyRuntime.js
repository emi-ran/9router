// Load only installed, explicitly allowlisted runtime dependencies. Never install at request time.
import { pathToFileURL } from "node:url";
import path from "node:path";

const inflight = new Map();
export function loadRuntimeDep(pkg) {
  if (pkg !== "wreq-js") return Promise.reject(new Error(`Unsupported runtime dependency: ${pkg}`));
  if (!inflight.has(pkg)) {
    const pending = import(/* webpackIgnore: true */ "node:module")
      .then(({ createRequire }) => createRequire(path.join(process.cwd(), "package.json")))
      .then((require) => import(/* webpackIgnore: true */ pathToFileURL(require.resolve(pkg)).href))
      .catch((error) => { inflight.delete(pkg); throw error; });
    inflight.set(pkg, pending);
  }
  return inflight.get(pkg);
}
