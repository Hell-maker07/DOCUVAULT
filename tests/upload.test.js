import express from 'express';
import request from 'supertest';
import { fileUpload } from '../src/middlewares/upload.js';
import { errorHandler } from '../src/middlewares/error.js';
import { sha256 } from '../src/utils/hash.js';

function createUploadTestApp(options = {}) {
  const app = express();
  app.use(express.json());

  app.post('/upload-test', fileUpload(options), (req, res) => {
    res.status(200).json({
      success: true,
      message: 'File received',
      data: {
        fieldName: req.file?.fieldname,
        originalName: req.file?.originalname,
        mimeType: req.file?.mimetype,
        sizeBytes: req.file?.size,
        sha256: req.file?.sha256,
        isBuffer: Buffer.isBuffer(req.file?.buffer),
      },
    });
  });

  app.use(errorHandler);
  return app;
}

describe('Step 4: Multer In-Memory Upload Middleware (Sakshi)', () => {
  it('receives a valid file in memory and automatically computes its SHA-256 fingerprint', async () => {
    const app = createUploadTestApp();
    const fileContent = Buffer.from('Confidential court transcript evidence content');
    const expectedHash = sha256(fileContent);

    const res = await request(app)
      .post('/upload-test')
      .attach('file', fileContent, 'transcript.pdf');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.originalName).toBe('transcript.pdf');
    expect(res.body.data.mimeType).toBe('application/pdf');
    expect(res.body.data.sizeBytes).toBe(fileContent.length);
    expect(res.body.data.sha256).toBe(expectedHash);
    expect(res.body.data.isBuffer).toBe(true);
  });

  it('rejects uploads exceeding the max file size limit with 413 FILE_TOO_LARGE', async () => {
    // Set low limit for testing: 0.001 MB (~1KB)
    const app = createUploadTestApp({ maxMb: 0.001 });
    const largeBuffer = Buffer.alloc(5 * 1024, 'X'); // 5KB > 1KB

    const res = await request(app)
      .post('/upload-test')
      .attach('file', largeBuffer, 'large_payload.pdf');

    expect(res.status).toBe(413);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('FILE_TOO_LARGE');
    expect(res.body.error.message).toMatch(/exceeds the maximum upload limit/i);
  });

  it('rejects unsupported MIME types with 415 UNSUPPORTED_TYPE', async () => {
    const app = createUploadTestApp();
    const executableBuffer = Buffer.from('MZ... executable binary payload');

    const res = await request(app).post('/upload-test').attach('file', executableBuffer, {
      filename: 'malware.exe',
      contentType: 'application/x-msdownload',
    });

    expect(res.status).toBe(415);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('UNSUPPORTED_TYPE');
    expect(res.body.error.message).toMatch(/unsupported file type/i);
  });

  it('rejects requests missing the file when required with 400 VALIDATION_ERROR', async () => {
    const app = createUploadTestApp({ required: true });

    const res = await request(app).post('/upload-test').field('otherField', 'some-value');

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.message).toMatch(/file is required/i);
  });

  it('allows requests without a file when required is false', async () => {
    const app = createUploadTestApp({ required: false });

    const res = await request(app)
      .post('/upload-test')
      .field('title', 'Document metadata without file');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.originalName).toBeUndefined();
  });
});
