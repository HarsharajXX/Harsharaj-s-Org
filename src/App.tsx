import { BrowserRouter, Route, Routes, useLocation } from 'react-router-dom';
import { useEffect } from 'react';
import { StoreProvider } from './context/StoreContext';
import { Navbar } from './components/Navbar';
import { Footer } from './components/Footer';
import { SearchOverlay } from './components/SearchOverlay';
import { ToastContainer } from './components/ToastContainer';
import { HomePage } from './pages/HomePage';
import { ShopPage } from './pages/ShopPage';
import { CommunitiesPage } from './pages/CommunitiesPage';
import { CommunityDetailPage } from './pages/CommunityDetailPage';
import { ProductDetailPage } from './pages/ProductDetailPage';
import { CartPage } from './pages/CartPage';
import { CheckoutPage } from './pages/CheckoutPage';
import { OurStoryPage } from './pages/OurStoryPage';
import { ArtisansPage, ArtisanDetailPage } from './pages/ArtisansPage';
import { BecomeSellerPage } from './pages/BecomeSellerPage';
import {
  AccountPage,
  ContactPage,
  LoginPage,
  OrdersPage,
  RegisterPage,
  SearchPage,
  WishlistPage,
} from './pages/AccountPages';
import {
  ForgotPasswordPage,
  ResetPasswordPage,
  SellerLoginPage,
  SellerRegisterPage,
  UnauthorizedPage,
  VerifyEmailPage,
} from './pages/AuthPages';
import { SellerDashboardPage } from './pages/seller/SellerDashboardPage';
import { AdminDashboardPage } from './pages/admin/AdminDashboardPage';
import { ProtectedRoute } from './components/ProtectedRoute';

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}

export default function App() {
  return (
    <StoreProvider>
      <BrowserRouter>
        <ScrollToTop />
        <div className="min-h-screen flex flex-col bg-[#F2EDE4] text-[#514B43]">
          <Navbar />
          <main className="flex-1">
            <Routes>
              <Route path="/" element={<HomePage />} />
              <Route path="/shop" element={<ShopPage />} />
              <Route path="/communities" element={<CommunitiesPage />} />
              <Route path="/collections" element={<CommunitiesPage />} />
              <Route path="/community/:slug" element={<CommunityDetailPage />} />
              <Route path="/category/:slug" element={<ShopPage />} />
              <Route path="/product/:slug" element={<ProductDetailPage />} />
              <Route path="/search" element={<SearchPage />} />
              <Route path="/cart" element={<CartPage />} />
              <Route path="/checkout" element={<CheckoutPage />} />
              <Route path="/our-story" element={<OurStoryPage />} />
              <Route path="/artisans" element={<ArtisansPage />} />
              <Route path="/artisan/:slug" element={<ArtisanDetailPage />} />
              <Route path="/become-a-seller" element={<BecomeSellerPage />} />
              <Route path="/contact" element={<ContactPage />} />
              <Route path="/login" element={<LoginPage />} />
              <Route path="/register" element={<RegisterPage />} />
              <Route path="/seller/login" element={<SellerLoginPage />} />
              <Route path="/seller/register" element={<SellerRegisterPage />} />
              <Route path="/verify-email" element={<VerifyEmailPage />} />
              <Route path="/forgot-password" element={<ForgotPasswordPage />} />
              <Route path="/reset-password" element={<ResetPasswordPage />} />
              <Route path="/unauthorized" element={<UnauthorizedPage />} />
              <Route
                path="/account"
                element={
                  <ProtectedRoute allowedRoles={['customer', 'seller', 'super_admin', 'operations_admin', 'content_admin']}>
                    <AccountPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/account/orders"
                element={
                  <ProtectedRoute allowedRoles={['customer', 'seller', 'super_admin', 'operations_admin', 'content_admin']}>
                    <OrdersPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/seller/dashboard"
                element={
                  <ProtectedRoute allowedRoles={['seller', 'super_admin']}>
                    <SellerDashboardPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/admin"
                element={
                  <ProtectedRoute allowedRoles={['super_admin', 'operations_admin', 'content_admin']}>
                    <AdminDashboardPage />
                  </ProtectedRoute>
                }
              />
              <Route path="/wishlist" element={<WishlistPage />} />
            </Routes>
          </main>
          <Footer />
          <SearchOverlay />
          <ToastContainer />
        </div>
      </BrowserRouter>
    </StoreProvider>
  );
}
