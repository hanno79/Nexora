/*
Author: rahn
Datum: 08.03.2026
Version: 1.0
Beschreibung: Registriert PRD-Kommentar-Routen als kleines Modul.
*/

// ÄNDERUNG 08.03.2026: Kommentar-Routen aus `server/routes.ts` extrahiert,
// um die Hauptdatei konservativ weiter zu verkleinern.

import type { Request, RequestHandler } from 'express';
import { asyncHandler } from './asyncHandler';
import { requirePrdAccess } from './prdAccess';
import type { IStorage } from './storage';

type AuthenticatedRequest = Request & {
  user: {
    claims: {
      sub: string;
    };
  };
};

type CommentUser = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  profileImageUrl: string | null;
};

type RequestHandlerRegistrar = (path: string, ...handlers: RequestHandler[]) => unknown;
type RouteRegistrar = Pick<{ [K in 'get' | 'post']: RequestHandlerRegistrar }, 'get' | 'post'>;
type PrdCommentStorage = Pick<IStorage, 'getPrd' | 'getPrdShares' | 'getComments' | 'createComment' | 'getUser'>;
type StoredComment = Awaited<ReturnType<PrdCommentStorage['getComments']>>[number];

export interface PrdCommentRouteDependencies {
  storage: PrdCommentStorage;
  requirePrdAccess: typeof requirePrdAccess;
  loadUsersByIds: (userIds: string[]) => Promise<CommentUser[]>;
  broadcastPrdUpdate: (prdId: string, event: string) => void;
}

function buildCommentResponse(comment: StoredComment, user: CommentUser | null) {
  return {
    ...comment,
    user: user ? {
      id: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      profileImageUrl: user.profileImageUrl,
    } : null,
  };
}

export function registerPrdCommentRoutes(
  app: RouteRegistrar,
  isAuthenticated: RequestHandler,
  deps: PrdCommentRouteDependencies,
): void {
  app.get('/api/prds/:id/comments', isAuthenticated, asyncHandler(async (req: AuthenticatedRequest, res) => {
    const { id } = req.params;
    const prd = await deps.requirePrdAccess(deps.storage, req, res, id, 'view');
    if (!prd) {
      return;
    }

    const commentsData = await deps.storage.getComments(id);
    const userIds = Array.from(new Set(commentsData.map((comment) => comment.userId)));
    const usersData = userIds.length > 0 ? await deps.loadUsersByIds(userIds) : [];
    const userMap = new Map(usersData.map((user) => [user.id, user]));

    res.json(commentsData.map((comment) => buildCommentResponse(comment, userMap.get(comment.userId) ?? null)));
  }));

  app.post('/api/prds/:id/comments', isAuthenticated, asyncHandler(async (req: AuthenticatedRequest, res) => {
    const { id } = req.params;
    const prd = await deps.requirePrdAccess(deps.storage, req, res, id, 'view');
    if (!prd) {
      return;
    }

    const userId = req.user.claims.sub;
    const { content, sectionId } = req.body as { content?: string; sectionId?: string | null };

    if (!content || content.trim() === '') {
      return res.status(400).json({ message: 'Comment content is required' });
    }

    const comment = await deps.storage.createComment({
      prdId: id,
      userId,
      content,
      sectionId: sectionId || null,
    });

    const user = await deps.storage.getUser(userId);
    res.json(buildCommentResponse(comment, user ?? null));
    deps.broadcastPrdUpdate(id, 'comment:added');
  }));
}