import axios from 'axios';
import {
  getApiBaseUrl,
  handleExpiredSession,
  isJwtExpired,
  refreshAuthTokenIfPossible,
} from '../utils/authSession';

const PUBLIC_AUTH_PATHS = [
  '/api/auth/login',
  '/api/auth/admin-login',
  '/api/auth/hr-login',
  '/api/auth/register',
  '/api/auth/refresh',
  '/api/teamlead/login',
  '/api/teamlead/register',
];

const isPublicAuthRequest = (url = '') =>
  PUBLIC_AUTH_PATHS.some((path) => String(url).includes(path));

/**
 * Arshith Connect - API Service
 * Configured Axios instance ready for FastAPI backend integration.
 */
const api = axios.create({
  baseURL: getApiBaseUrl(),
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 30000,
});

// Request Interceptor: Attach Auth Token (refreshing expired JWTs proactively) and handle FormData boundary
api.interceptors.request.use(
  async (config) => {
    let token = localStorage.getItem('arshith_auth_token');
    if (token && !isPublicAuthRequest(config.url) && isJwtExpired(token)) {
      const refreshed = await refreshAuthTokenIfPossible();
      if (refreshed) {
        token = refreshed;
      } else {
        handleExpiredSession();
        return Promise.reject(new axios.Cancel('Session expired. Please log in again.'));
      }
    }

    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    // When sending FormData, delete Content-Type so browser/Axios generates multipart/form-data with exact boundary
    if (config.data instanceof FormData) {
      delete config.headers['Content-Type'];
      delete config.headers['content-type'];
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// Response Interceptor: Transparently refresh expired tokens once on 401 or clear stale session
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalConfig = error.config;
    if (
      error.response &&
      error.response.status === 401 &&
      originalConfig &&
      !originalConfig._retried &&
      !isPublicAuthRequest(originalConfig.url)
    ) {
      originalConfig._retried = true;
      const refreshed = await refreshAuthTokenIfPossible();
      if (refreshed) {
        originalConfig.headers = originalConfig.headers || {};
        originalConfig.headers.Authorization = `Bearer ${refreshed}`;
        return api(originalConfig);
      }
      handleExpiredSession();
    }
    return Promise.reject(error);
  }
);

export { authService } from './authService';
export { attendanceService } from './attendanceService';
export { leaveService } from './leaveService';
export { holidayService } from './holidayService';
export { meetingService } from './meetingService';
export { announcementService } from './announcementService';
export { employeeService } from './employeeService';
export { reportService } from './reportService';
export { teamService } from './teamService';
export { assignmentService } from './assignmentService';
export { workUpdateService } from './workUpdateService';
export { registrationRequestService } from './registrationRequestService';
export { officeTimingService } from './officeTimingService';
export { dashboardService } from './dashboardService';
export { payrollService } from './payrollService';
export { payslipService } from './payslipService';
export { paymentService } from './paymentService';
export { loanService } from './loanService';
export { separationService } from './separationService';
export { recruitmentService } from './recruitmentService';
export { performanceService } from './performanceService';
export { departmentService } from './departmentService';
export { auditService } from './auditService';
export { settingsService } from './settingsService';
export { chatService } from './chatService';
export { projectService } from './projectService';
export { teamLeaderService } from './teamLeaderService';
export { employeeTaskService } from './employeeTaskService';

export default api;

