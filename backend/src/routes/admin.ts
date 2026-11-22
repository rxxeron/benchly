import express from 'express';
import { AdminRoutesDeps, createAdminHelpers } from './admin/helpers';
import { registerAdminAnalyticsRoutes } from './admin/analytics';
import { registerAdminGrowthRoutes } from './admin/growth';
import { registerAdminModerationRoutes } from './admin/moderation';
import { registerAdminContentRoutes } from './admin/content';

export type { AdminRoutesDeps };

export function registerAdminRoutes(app: express.Express, deps: AdminRoutesDeps) {
    const helpers = createAdminHelpers(deps);
    registerAdminAnalyticsRoutes(app, deps, helpers);
    registerAdminGrowthRoutes(app, deps, helpers);
    registerAdminModerationRoutes(app, deps, helpers);
    registerAdminContentRoutes(app, deps, helpers);
}
