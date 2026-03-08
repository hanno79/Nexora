/*
Author: rahn
Datum: 08.03.2026
Version: 1.0
Beschreibung: Registriert PRD-Approval-Routen als kleines Modul.
*/

// ÄNDERUNG 08.03.2026: Approval-Routen aus `server/routes.ts` extrahiert,
// um die Hauptdatei konservativ weiter zu verkleinern.

import type { Request, RequestHandler } from 'express';
import { validateApprovalReviewers } from './approvalReviewers';
import { asyncHandler } from './asyncHandler';
import { requirePrdAccess } from './prdAccess';
import { requestApprovalSchema, respondApprovalSchema } from './schemas';
import type { IStorage } from './storage';

type AuthenticatedRequest = Request & {
  user: {
    claims: {
      sub: string;
    };
  };
};

type ApprovalUser = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
};

type RequestHandlerRegistrar = (path: string, ...handlers: RequestHandler[]) => unknown;
type RouteRegistrar = Pick<{ [K in 'get' | 'post']: RequestHandlerRegistrar }, 'get' | 'post'>;
type PrdApprovalStorage = Pick<
  IStorage,
  'getPrd' | 'getPrdShares' | 'getApproval' | 'createApproval' | 'updateApproval' | 'updatePrd' | 'getUser'
>;

export interface PrdApprovalRouteDependencies {
  storage: PrdApprovalStorage;
  requirePrdAccess: typeof requirePrdAccess;
  loadUsersByIds: (userIds: string[]) => Promise<ApprovalUser[]>;
  broadcastPrdUpdate: (prdId: string, event: string) => void;
}

function mapApprovalUser(user: ApprovalUser | null | undefined) {
  return user ? {
    id: user.id,
    firstName: user.firstName,
    lastName: user.lastName,
    email: user.email,
  } : null;
}

export function registerPrdApprovalRoutes(
  app: RouteRegistrar,
  isAuthenticated: RequestHandler,
  deps: PrdApprovalRouteDependencies,
): void {
  app.get('/api/prds/:id/approval', isAuthenticated, asyncHandler(async (req: AuthenticatedRequest, res) => {
    const { id } = req.params;
    const prd = await deps.requirePrdAccess(deps.storage, req, res, id, 'view');
    if (!prd) {
      return;
    }

    const approval = await deps.storage.getApproval(id);
    if (!approval) {
      return res.json(null);
    }

    const relatedUserIds = Array.from(new Set([approval.requestedBy, approval.completedBy].filter(Boolean) as string[]));
    const relatedUsers = relatedUserIds.length > 0 ? await deps.loadUsersByIds(relatedUserIds) : [];
    const userMap = new Map(relatedUsers.map((user) => [user.id, user]));

    res.json({
      ...approval,
      requester: mapApprovalUser(userMap.get(approval.requestedBy)),
      completer: mapApprovalUser(approval.completedBy ? userMap.get(approval.completedBy) : null),
    });
  }));

  app.post('/api/prds/:id/approval/request', isAuthenticated, asyncHandler(async (req: AuthenticatedRequest, res) => {
    const { id } = req.params;
    const prd = await deps.requirePrdAccess(deps.storage, req, res, id, 'edit');
    if (!prd) {
      return;
    }

    const userId = req.user.claims.sub;
    const { reviewers } = requestApprovalSchema.parse(req.body);
    const existingApproval = await deps.storage.getApproval(id);
    if (existingApproval && existingApproval.status === 'pending') {
      return res.status(400).json({ message: 'There is already a pending approval request' });
    }

    const shares = await deps.storage.getPrdShares(id);
    const { normalizedReviewerIds, unauthorizedReviewerIds } = validateApprovalReviewers(
      reviewers,
      prd.userId,
      shares,
    );

    if (normalizedReviewerIds.length === 0) {
      return res.status(400).json({ message: 'At least one valid reviewer is required' });
    }

    if (unauthorizedReviewerIds.length > 0) {
      return res.status(400).json({ message: 'All reviewers must already have access to this PRD' });
    }

    const approval = await deps.storage.createApproval({
      prdId: id,
      requestedBy: userId,
      reviewers: normalizedReviewerIds,
      status: 'pending',
    });

    await deps.storage.updatePrd(id, { status: 'pending-approval' });

    const requester = await deps.storage.getUser(userId);
    res.json({
      ...approval,
      requester: mapApprovalUser(requester ?? null),
    });
  }));

  app.post('/api/prds/:id/approval/respond', isAuthenticated, asyncHandler(async (req: AuthenticatedRequest, res) => {
    const { id } = req.params;
    const userId = req.user.claims.sub;
    const { approved } = respondApprovalSchema.parse(req.body);
    const prd = await deps.requirePrdAccess(deps.storage, req, res, id, 'view');
    if (!prd) {
      return;
    }

    const approval = await deps.storage.getApproval(id);
    if (!approval) {
      return res.status(404).json({ message: 'No approval request found' });
    }

    if (approval.status !== 'pending') {
      return res.status(400).json({ message: 'Approval request is no longer pending' });
    }

    if (!approval.reviewers.includes(userId)) {
      return res.status(403).json({ message: 'You are not a reviewer for this PRD' });
    }

    const updatedApproval = await deps.storage.updateApproval(approval.id, {
      status: approved ? 'approved' : 'rejected',
      completedBy: userId,
      completedAt: new Date(),
    });

    await deps.storage.updatePrd(id, { status: approved ? 'approved' : 'review' });

    const completer = await deps.storage.getUser(userId);
    res.json({
      ...updatedApproval,
      completer: mapApprovalUser(completer ?? null),
    });
    deps.broadcastPrdUpdate(id, 'approval:updated');
  }));
}