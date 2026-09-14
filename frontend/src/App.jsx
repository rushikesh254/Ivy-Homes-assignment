import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { SessionProvider } from './context/session'
import { AuthGuard, Shell } from './components/chrome'
import LoginView from './views/LoginView'
import ListingsView from './views/ListingsView'
import ListingView from './views/ListingView'
import RentalsView from './views/RentalsView'
import RentalDetailView from './views/RentalDetailView'
import ProjectsView from './views/ProjectsView'
import ProjectDetailView from './views/ProjectDetailView'
import SavedView from './views/SavedView'
import InsightsView from './views/InsightsView'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 2 * 60 * 1000,
      retry: 1,
    },
  },
})

function Guarded({ children }) {
  return <AuthGuard><Shell>{children}</Shell></AuthGuard>
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <SessionProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<LoginView />} />
            <Route path="/listings" element={<Guarded><ListingsView /></Guarded>} />
            <Route path="/listings/:id" element={<Guarded><ListingView /></Guarded>} />
            <Route path="/rentals" element={<Guarded><RentalsView /></Guarded>} />
            <Route path="/rentals/:id" element={<Guarded><RentalDetailView /></Guarded>} />
            <Route path="/projects" element={<Guarded><ProjectsView /></Guarded>} />
            <Route path="/projects/:id" element={<Guarded><ProjectDetailView /></Guarded>} />
            <Route path="/saved" element={<Guarded><SavedView /></Guarded>} />
            <Route path="/insights" element={<Guarded><InsightsView /></Guarded>} />
            <Route path="/" element={<Navigate to="/listings" replace />} />
            <Route path="*" element={<Navigate to="/listings" replace />} />
          </Routes>
        </BrowserRouter>
      </SessionProvider>
    </QueryClientProvider>
  )
}