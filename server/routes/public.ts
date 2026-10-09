import type { FastifyInstance } from "fastify";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import type { AppConfig } from "../config";
import type { Database } from "../db/client";
import { AppError } from "../lib/errors";
import { parseRange } from "../services/audio";
import { getAudioAssetByToken, getPublicShare } from "../services/shares";

type Dependencies = { config: AppConfig; db: Database };

export async function registerPublicRoutes(
  app: FastifyInstance,
  { config, db }: Dependencies,
) {
  app.get<{ Params: { token: string } }>(
    "/api/public/shares/:token",
    async (request) => getPublicShare(db, config, request.params.token),
  );

  app.get<{ Params: { token: string }; Headers: { range?: string } }>(
    "/api/public/shares/:token/audio",
    async (request, reply) => {
      const { asset } = await getAudioAssetByToken(db, request.params.token);
      const file = await stat(asset.storagePath).catch(() => null);
      if (!file?.isFile())
        throw new AppError(404, "audio_not_found", "云端音乐不存在。");
      const range = parseRange(request.headers.range, file.size);
      reply.header("Accept-Ranges", "bytes");
      reply.header("Content-Type", asset.mimeType);
      reply.header(
        "Content-Disposition",
        `inline; filename*=UTF-8''${encodeURIComponent(asset.originalName)}`,
      );
      reply.header("Cache-Control", "private, no-store");
      if (!range) {
        reply.header("Content-Length", String(file.size));
        return reply.send(createReadStream(asset.storagePath));
      }
      reply.code(206);
      reply.header("Content-Length", String(range.end - range.start + 1));
      reply.header(
        "Content-Range",
        `bytes ${range.start}-${range.end}/${file.size}`,
      );
      return reply.send(createReadStream(asset.storagePath, range));
    },
  );
}
