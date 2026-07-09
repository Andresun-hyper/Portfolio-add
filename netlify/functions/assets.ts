import type { Config } from '@netlify/functions';
import { writeAuditEvent } from './_lib/audit';
import { uploadPayloadSchema, validateAndReencodeImage } from './_lib/image';
import { assertOrigin, requireSession } from './_lib/security';
import { errorResponse, json, readJsonBody } from './_lib/http';
import { writeAsset } from './_lib/github';

export const config: Config = {
  path: '/api/assets',
  rateLimit: {
    action: 'rate_limit',
    aggregateBy: ['ip', 'domain'],
    windowLimit: 20,
    windowSize: 60,
  },
};

export default async function handler(request: Request) {
  try {
    if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
    assertOrigin(request);
    const session = await requireSession(request, { csrf: true });
    const payload = uploadPayloadSchema.parse(await readJsonBody(request, 12_000_000));
    const image = await validateAndReencodeImage(payload);
    const result = await writeAsset(image.path, image.bytes, `Upload portfolio asset ${image.hash}.${image.ext}`);
    await writeAuditEvent({
      actor: session.actor,
      action: 'upload_asset',
      target: image.path,
      commitSha: result.commitSha,
      metadata: { src: image.src, bytes: image.bytes.byteLength },
    });
    return json({ ...result, src: image.src, hash: image.hash, ext: image.ext });
  } catch (error) {
    return errorResponse(error);
  }
}
