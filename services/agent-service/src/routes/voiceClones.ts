import { Router, RequestHandler } from 'express';
import multer from 'multer';
import * as ctrl from '../controllers/voiceClone.controller';

export const voiceCloneRouter = Router();

// 10 MB in-memory upload (audio sample)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

voiceCloneRouter.get('/', ctrl.listClonedVoices);
voiceCloneRouter.post('/', upload.single('audio') as unknown as RequestHandler, ctrl.createClonedVoice);
voiceCloneRouter.get('/:id/sample', ctrl.getClonedVoiceSample);
voiceCloneRouter.post('/:id/retry', ctrl.retryClonedVoice);
voiceCloneRouter.post('/:id/test', ctrl.testClonedVoice);
voiceCloneRouter.post('/:id/assign-to-agent', ctrl.assignClonedVoiceToAgent);
voiceCloneRouter.delete('/:id', ctrl.deleteClonedVoice);
