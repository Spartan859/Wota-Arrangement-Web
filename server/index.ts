import { buildApp } from "./app";
import { loadConfig } from "./config";
import { ensureStorageRoot } from "./services/audio";

const config = loadConfig();
await ensureStorageRoot(config.AUDIO_STORAGE_DIR);
const app = await buildApp(config);
await app.listen({ host: config.HOST, port: config.PORT });
