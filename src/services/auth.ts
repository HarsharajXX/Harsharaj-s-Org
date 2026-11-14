import { isSupabaseConfigured, supabase } from '../lib/supabase';
import type { SellerAccountStatus, UserRole } from '../types';

export type { UserRole, SellerAccountStatus };

export interface AuthUser {
  id: string;
  email: string;
  fullName: string;
  phone?: string;
  roles: UserRole[];
  emailVerified: boolean;
  isDemo: boolean;
  sellerProfile?: {
    storeName: string;
    sellerType: string;
    state: string;
    district: string;
    emailVerified: boolean;
    accountStatus: SellerAccountStatus;
    payoutVerificationStatus: 'unverified' | 'pending' | 'verified';
  };
}

export const authService = {
  isLive(): boolean {
    return Boolean(isSupabaseConfigured && supabase);
  },

  async signUpCustomer(params: {
    email: string;
    password: string;
    fullName: string;
  }): Promise<{ user: AuthUser | null; needsVerification: boolean; error?: string }> {
    if (!this.isLive() || !supabase) {
      return {
        user: {
          id: `demo-cust-${Date.now()}`,
          email: params.email,
          fullName: params.fullName,
          roles: ['customer'],
          emailVerified: false,
          isDemo: true,
        },
        needsVerification: true,
      };
    }

    const { data, error } = await supabase.auth.signUp({
      email: params.email,
      password: params.password,
      options: {
        data: {
          full_name: params.fullName,
          intended_role: 'customer',
        },
        emailRedirectTo: `${window.location.origin}/verify-email`,
      },
    });

    if (error) return { user: null, needsVerification: false, error: error.message };

    return {
      user: data.user
        ? {
            id: data.user.id,
            email: data.user.email || params.email,
            fullName: params.fullName,
            roles: ['customer'],
            emailVerified: Boolean(data.user.email_confirmed_at),
            isDemo: false,
          }
        : null,
      needsVerification: !data.user?.email_confirmed_at,
    };
  },

  async signUpSeller(params: {
    email: string;
    password: string;
    fullName: string;
    storeName: string;
    phone: string;
    state: string;
    district: string;
    sellerType: string;
    description: string;
    categories: string;
  }): Promise<{ user: AuthUser | null; needsVerification: boolean; error?: string }> {
    if (!this.isLive() || !supabase) {
      return {
        user: {
          id: `demo-seller-${Date.now()}`,
          email: params.email,
          fullName: params.fullName,
          phone: params.phone,
          roles: ['seller'],
          emailVerified: false,
          isDemo: true,
          sellerProfile: {
            storeName: params.storeName,
            sellerType: params.sellerType,
            state: params.state,
            district: params.district,
            emailVerified: false,
            accountStatus: 'pending_email_verification',
            payoutVerificationStatus: 'unverified',
          },
        },
        needsVerification: true,
      };
    }

    const { data, error } = await supabase.auth.signUp({
      email: params.email,
      password: params.password,
      options: {
        data: {
          full_name: params.fullName,
          intended_role: 'seller',
          store_name: params.storeName,
          phone: params.phone,
          state: params.state,
          district: params.district,
          seller_type: params.sellerType,
        },
        emailRedirectTo: `${window.location.origin}/verify-email`,
      },
    });

    if (error) return { user: null, needsVerification: false, error: error.message };

    return {
      user: data.user
        ? {
            id: data.user.id,
            email: data.user.email || params.email,
            fullName: params.fullName,
            phone: params.phone,
            roles: ['seller'],
            emailVerified: Boolean(data.user.email_confirmed_at),
            isDemo: false,
            sellerProfile: {
              storeName: params.storeName,
              sellerType: params.sellerType,
              state: params.state,
              district: params.district,
              emailVerified: Boolean(data.user.email_confirmed_at),
              accountStatus: data.user.email_confirmed_at
                ? 'pending_approval'
                : 'pending_email_verification',
              payoutVerificationStatus: 'unverified',
            },
          }
        : null,
      needsVerification: !data.user?.email_confirmed_at,
    };
  },

  async signIn(params: {
    email: string;
    password: string;
    expectedRole?: UserRole;
  }): Promise<{ user: AuthUser | null; error?: string }> {
    if (!this.isLive() || !supabase) {
      const role: UserRole = params.expectedRole || 'customer';
      return {
        user: {
          id: `demo-${role}-1`,
          email: params.email,
          fullName: role === 'seller' ? 'Demo Seller' : 'Demo Patron',
          roles: [role],
          emailVerified: true,
          isDemo: true,
          ...(role === 'seller'
            ? {
                sellerProfile: {
                  storeName: 'Sualkuchi Loom Collective (Demo)',
                  sellerType: 'Weaver Collective',
                  state: 'Assam',
                  district: 'Kamrup',
                  emailVerified: true,
                  accountStatus: 'active' as SellerAccountStatus,
                  payoutVerificationStatus: 'unverified' as const,
                },
              }
            : {}),
        },
      };
    }

    const { data, error } = await supabase.auth.signInWithPassword({
      email: params.email,
      password: params.password,
    });

    if (error || !data.user) {
      return { user: null, error: error?.message || 'Sign in failed' };
    }

    const { data: roleRows } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', data.user.id);

    const roles = (roleRows?.map((r) => r.role as UserRole) || ['customer']);

    if (
      params.expectedRole &&
      !roles.includes(params.expectedRole) &&
      !roles.includes('super_admin')
    ) {
      await supabase.auth.signOut();
      return {
        user: null,
        error: `This account does not have ${params.expectedRole.replace(/_/g, ' ')} access.`,
      };
    }

    let sellerProfile: AuthUser['sellerProfile'] | undefined;
    if (roles.includes('seller')) {
      const { data: sp } = await supabase
        .from('seller_profiles')
        .select(
          'business_name, seller_type, state, district, email_verified, account_status, payout_verification_status'
        )
        .eq('user_id', data.user.id)
        .maybeSingle();

      if (sp) {
        const validStatuses: SellerAccountStatus[] = [
          'pending_email_verification',
          'pending_approval',
          'active',
          'suspended',
          'rejected',
        ];
        const accountStatus = validStatuses.includes(sp.account_status as SellerAccountStatus)
          ? (sp.account_status as SellerAccountStatus)
          : 'pending_email_verification';

        sellerProfile = {
          storeName: sp.business_name,
          sellerType: sp.seller_type || 'Weaver',
          state: sp.state || '',
          district: sp.district || '',
          emailVerified: Boolean(sp.email_verified ?? data.user.email_confirmed_at),
          accountStatus,
          payoutVerificationStatus:
            sp.payout_verification_status === 'verified'
              ? 'verified'
              : sp.payout_verification_status === 'pending'
                ? 'pending'
                : 'unverified',
        };
      }
    }

    return {
      user: {
        id: data.user.id,
        email: data.user.email || params.email,
        fullName: (data.user.user_metadata?.full_name as string) || 'NOHAJ Member',
        roles,
        emailVerified: Boolean(data.user.email_confirmed_at),
        isDemo: false,
        sellerProfile,
      },
    };
  },

  async signOut(): Promise<void> {
    if (this.isLive() && supabase) {
      await supabase.auth.signOut();
    }
  },

  async requestPasswordReset(email: string): Promise<{ ok: boolean; error?: string }> {
    if (!this.isLive() || !supabase) {
      return { ok: true };
    }
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    return error ? { ok: false, error: error.message } : { ok: true };
  },

  async updatePassword(newPassword: string): Promise<{ ok: boolean; error?: string }> {
    if (!this.isLive() || !supabase) {
      return { ok: true };
    }
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    return error ? { ok: false, error: error.message } : { ok: true };
  },
};
