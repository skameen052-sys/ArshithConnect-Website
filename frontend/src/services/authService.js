import api from './api';
import { chatService } from './chatService';
import { loginWithFirebase } from '../firebase/auth';
import { db } from '../firebase/firebaseConfig';
import { getDoc, doc, getDocs, collection, query, where } from 'firebase/firestore';

async function lookupFirestoreEmployee(fbUser, cleanEmail) {
  try {
    if (!db) return null;

    if (fbUser?.uid) {
      try {
        const docRef = doc(db, 'employees', fbUser.uid);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          return { id: docSnap.id, ...docSnap.data() };
        }
      } catch {}
    }

    if (cleanEmail) {
      try {
        const q = query(collection(db, 'employees'), where('email', '==', cleanEmail));
        const qSnap = await getDocs(q);
        if (!qSnap.empty) {
          return { id: qSnap.docs[0].id, ...qSnap.docs[0].data() };
        }
      } catch {}

      try {
        const qUsers = query(collection(db, 'users'), where('email', '==', cleanEmail));
        const qUsersSnap = await getDocs(qUsers);
        if (!qUsersSnap.empty) {
          return { id: qUsersSnap.docs[0].id, ...qUsersSnap.docs[0].data() };
        }
      } catch {}
    }
  } catch (err) {
    console.warn('[AuthService] Firestore employee fallback query note:', err);
  }
  return null;
}

async function lookupFirestoreAdmin(fbUser, cleanEmail) {
  try {
    if (!db) return null;

    if (fbUser?.uid) {
      try {
        const docRef = doc(db, 'admins', fbUser.uid);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          return { id: docSnap.id, ...docSnap.data() };
        }
      } catch {}
    }

    if (cleanEmail) {
      try {
        const q = query(collection(db, 'admins'), where('email', '==', cleanEmail));
        const qSnap = await getDocs(q);
        if (!qSnap.empty) {
          return { id: qSnap.docs[0].id, ...qSnap.docs[0].data() };
        }
      } catch {}

      try {
        const qUsers = query(collection(db, 'users'), where('email', '==', cleanEmail));
        const qUsersSnap = await getDocs(qUsers);
        if (!qUsersSnap.empty) {
          return { id: qUsersSnap.docs[0].id, ...qUsersSnap.docs[0].data() };
        }
      } catch {}
    }
  } catch (err) {
    console.warn('[AuthService] Firestore admin fallback query note:', err);
  }
  return null;
}

/**
 * AuthService - Handles Employee & Admin Authentication
 * Connected to FastAPI backend with PostgreSQL persistent authentication.
 */
export const authService = {
  /**
   * Employee Login
   * @param {Object} credentials { email, password }
   */
  async login({ email, password }) {
    try {
      const cleanEmail = String(email || '').trim().toLowerCase();
      let fbRes = null;
      try {
        fbRes = await loginWithFirebase(cleanEmail, password);
      } catch (fbErr) {
        console.warn('[AuthService] Firebase login attempt warning:', fbErr);
      }

      try {
        const response = await api.post('/api/auth/login', {
          email: cleanEmail,
          password,
        });

        const { access_token, role, user } = response.data;
        if (role !== 'employee') {
          throw new Error('Admin credentials cannot be used to log in through Employee Login. Please use the Admin Login page.');
        }
        if (access_token) {
          localStorage.setItem('arshith_auth_token', access_token);
          localStorage.setItem('arshith_role', 'employee');
          localStorage.setItem('arshith_user', JSON.stringify(user));
        }
        return { success: true, user };
      } catch (backendError) {
        // If backend explicitly rejected credentials or returned validation error (400, 401, 403)
        if (backendError.response && backendError.response.status < 500) {
          const detail = backendError.response?.data?.detail || backendError.response?.data?.message || 'Invalid employee email or password.';
          throw new Error(detail);
        }

        // If backend is unreachable or 500+, check if Firebase client authenticated successfully
        if (fbRes?.user) {
          const fbToken = fbRes.token || (await fbRes.user.getIdToken());
          const empData = await lookupFirestoreEmployee(fbRes.user, cleanEmail);

          if (empData?.status === 'inactive') {
            throw new Error('Your account is currently inactive. Please contact administration.');
          }
          if (empData?.status === 'rejected') {
            throw new Error('Your registration has been rejected by administration.');
          }
          if (empData?.status === 'pending') {
            throw new Error('Your registration is awaiting admin approval. You can log in after your account is approved.');
          }

          const fallbackUser = {
            id: empData?.id || fbRes.user.uid,
            uid: fbRes.user.uid,
            email: cleanEmail,
            name: empData?.name || empData?.fullName || fbRes.user.displayName || cleanEmail.split('@')[0],
            employee_id: empData?.employee_id || empData?.employeeId || 'EMP',
            role: 'employee',
            department: empData?.department || 'General',
            designation: empData?.designation || 'Staff',
            status: empData?.status || 'approved',
            ...empData,
          };

          localStorage.setItem('arshith_auth_token', fbToken);
          localStorage.setItem('arshith_role', 'employee');
          localStorage.setItem('arshith_user', JSON.stringify(fallbackUser));

          return { success: true, user: fallbackUser };
        }

        // If Firebase failed due to wrong password or missing user
        if (fbRes?.error) {
          const code = fbRes.error.code;
          if (code === 'auth/wrong-password' || code === 'auth/invalid-credential') {
            throw new Error('Invalid employee email or password.');
          }
          if (code === 'auth/user-not-found') {
            throw new Error('No employee found with this email.');
          }
          if (code === 'auth/too-many-requests') {
            throw new Error('Too many failed login attempts. Please try again later.');
          }
        }

        // Neither backend nor Firebase could authenticate or connect
        throw backendError;
      }
    } catch (error) {
      localStorage.removeItem('arshith_auth_token');
      localStorage.removeItem('arshith_role');
      localStorage.removeItem('arshith_user');
      let msg = error.response?.data?.detail || error.response?.data?.message || error.message;
      if (!error.response && !error.message) {
        msg = 'Unable to connect to the server. Please check your backend URL or internet connection.';
      }
      throw new Error(msg);
    }
  },

  /**
   * Admin Login
   * @param {Object} credentials { email, password }
   */
  async adminLogin({ email, password }) {
    try {
      const cleanEmail = String(email || '').trim().toLowerCase();
      let fbRes = null;
      try {
        fbRes = await loginWithFirebase(cleanEmail, password);
      } catch (fbErr) {
        console.warn('[AuthService] Firebase admin login attempt warning:', fbErr);
      }

      try {
        const response = await api.post('/api/auth/admin-login', {
          email: cleanEmail,
          password,
        });

        const { access_token, role, user } = response.data;
        if (role !== 'admin') {
          throw new Error('Employee credentials cannot be used to log in through Admin Login. Please use the Employee Login page.');
        }
        if (access_token) {
          localStorage.setItem('arshith_auth_token', access_token);
          localStorage.setItem('arshith_role', 'admin');
          localStorage.setItem('arshith_user', JSON.stringify(user));
        }
        return { success: true, admin: user };
      } catch (backendError) {
        if (backendError.response && backendError.response.status < 500) {
          const detail = backendError.response?.data?.detail || backendError.response?.data?.message || 'Invalid administrator credentials';
          throw new Error(detail);
        }

        if (fbRes?.user) {
          const fbToken = fbRes.token || (await fbRes.user.getIdToken());
          const adminData = await lookupFirestoreAdmin(fbRes.user, cleanEmail);

          const fallbackAdmin = {
            id: adminData?.id || fbRes.user.uid,
            uid: fbRes.user.uid,
            email: cleanEmail,
            name: adminData?.name || adminData?.fullName || fbRes.user.displayName || 'Administrator',
            role: 'admin',
            ...adminData,
          };

          localStorage.setItem('arshith_auth_token', fbToken);
          localStorage.setItem('arshith_role', 'admin');
          localStorage.setItem('arshith_user', JSON.stringify(fallbackAdmin));

          return { success: true, admin: fallbackAdmin };
        }

        if (fbRes?.error) {
          const code = fbRes.error.code;
          if (code === 'auth/wrong-password' || code === 'auth/invalid-credential') {
            throw new Error('Invalid administrator credentials.');
          }
          if (code === 'auth/user-not-found') {
            throw new Error('No administrator account found with this email.');
          }
        }

        throw backendError;
      }
    } catch (error) {
      localStorage.removeItem('arshith_auth_token');
      localStorage.removeItem('arshith_role');
      localStorage.removeItem('arshith_user');
      const msg = error.response?.data?.detail || error.response?.data?.message || error.message || (error.response ? 'Invalid administrator credentials' : 'Unable to connect to the server. Please try again.');
      throw new Error(msg);
    }
  },

  /**
   * HR Login
   * @param {Object} credentials { email, password }
   */
  async hrLogin({ email, password }) {
    try {
      const response = await api.post('/api/auth/hr-login', {
        email: email.trim(),
        password,
      });

      const { access_token, role, user } = response.data;
      if (role !== 'hr' && role !== 'hr_projects' && role !== 'admin') {
        throw new Error('Access denied. Human Resources privileges required.');
      }
      if (access_token) {
        localStorage.setItem('arshith_auth_token', access_token);
        localStorage.setItem('arshith_role', role);
        localStorage.setItem('arshith_user', JSON.stringify(user));
      }
      return { success: true, user, role };
    } catch (error) {
      localStorage.removeItem('arshith_auth_token');
      localStorage.removeItem('arshith_role');
      localStorage.removeItem('arshith_user');
      const msg = error.response?.data?.detail || error.response?.data?.message || (error.response ? 'Invalid Human Resources credentials' : 'Unable to connect to the server. Please try again.');
      throw new Error(msg);
    }
  },

  /**
   * Project HR Login
   */
  async hrProjectsLogin({ email, password }) {
    return this.hrLogin({ email, password });
  },

  /**
   * Register new employee
   * @param {Object} employeeData
   */
  async register(employeeData) {
    try {
      const response = await api.post('/api/auth/register', {
        fullName: employeeData.fullName || employeeData.name,
        employeeId: employeeData.employeeId || employeeData.id,
        email: employeeData.email,
        phone: employeeData.phone || '--',
        password: employeeData.password,
        confirmPassword: employeeData.confirmPassword,
      });

      return {
        success: true,
        message: response.data?.message || 'Your registration request is awaiting admin approval.',
      };
    } catch (error) {
      const data = error.response?.data;
      let msg = typeof data?.detail === 'string' ? data.detail : data?.message;
      if (!error.response) {
        msg = 'Unable to connect to the server. Please check your connection and try again.';
      } else if (!msg) {
        if (error.response?.status >= 500) {
          msg = "We couldn't complete your registration right now. Please try again later.";
        } else {
          msg = 'Please check the form for errors.';
        }
      }
      const customErr = new Error(msg);
      customErr.status = error.response?.status;
      customErr.errors =
        data?.errors ||
        (typeof data?.detail === 'object' && data.detail?.errors ? data.detail.errors : null) ||
        {};
      customErr.detail = msg;
      throw customErr;
    }
  },

  /**
   * Retrieve current authenticated user from storage
   */
  getCurrentUser() {
    try {
      const data = localStorage.getItem('arshith_user');
      return data ? JSON.parse(data) : null;
    } catch {
      return null;
    }
  },

  /**
   * Fetch live authenticated user details from backend
   */
  async fetchMe() {
    try {
      const response = await api.get('/api/auth/me');
      if (response.data) {
        localStorage.setItem('arshith_user', JSON.stringify(response.data));
        localStorage.setItem('arshith_role', response.data.role);
      }
      return response.data;
    } catch {
      return this.getCurrentUser();
    }
  },

  /**
   * Log out session
   */
  logout() {
    const token = localStorage.getItem('arshith_auth_token');
    chatService.disconnectWebSocket();
    if (token) {
      try {
        api
          .post(
            '/api/auth/logout',
            {},
            { headers: { Authorization: `Bearer ${token}` } }
          )
          .catch(() => {});
      } catch {
        // Ignored
      }
    }
    localStorage.removeItem('arshith_role');
    localStorage.removeItem('arshith_user');
    localStorage.removeItem('arshith_auth_token');
  },
};

export default authService;
