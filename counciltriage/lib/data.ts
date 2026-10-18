/** Request-scoped data shared by several Server Components (React cache dedupes within one render). */
import { cache } from "react";
import { dashboardStats } from "./repo/reports";

export const getDashboardStats = cache(() => dashboardStats());
