import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { requireAuth } from '../auth.js';
import { badRequest } from '../errors.js';
import { config } from '../config.js';

/** Image uploads for avatars and server icons; returns the public URL. */
export const uploadsRouter = Router();

const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

const upload = multer({
  storage: multer.diskStorage({
    destination: config.uploadDir,
    filename: (_req, file, cb) => cb(null, `${randomUUID()}${path.extname(file.originalname).slice(0, 8)}`),
  }),
  limits: { fileSize: 8 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => cb(null, IMAGE_TYPES.has(file.mimetype)),
});

uploadsRouter.post('/uploads/image', requireAuth, upload.single('file'), (req, res) => {
  if (!req.file) throw badRequest('Envie uma imagem PNG, JPG, GIF ou WEBP de até 8 MB');
  res.status(201).json({ url: `/uploads/${req.file.filename}` });
});
