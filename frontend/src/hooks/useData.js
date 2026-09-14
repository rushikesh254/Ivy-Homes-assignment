import { useQuery } from '@tanstack/react-query'
import { listingApi, rentalApi, projectApi, crawl } from '../api/client'

export function useListings(params) {
  return useQuery({
    queryKey: ['listings', params],
    queryFn: () => listingApi.page(params),
  })
}

export function useListing(id) {
  return useQuery({
    queryKey: ['listing', id],
    queryFn: () => listingApi.one(id),
    enabled: Boolean(id),
  })
}

export function useRentals(params) {
  return useQuery({
    queryKey: ['rentals', params],
    queryFn: () => rentalApi.page(params),
  })
}

export function useRental(id) {
  return useQuery({
    queryKey: ['rental', id],
    queryFn: () => rentalApi.one(id),
    enabled: Boolean(id),
  })
}

export function useProject(id) {
  return useQuery({
    queryKey: ['project', id],
    queryFn: () => projectApi.one(id),
    enabled: Boolean(id),
  })
}

export function useProjects(params) {
  return useQuery({
    queryKey: ['projects', params],
    queryFn: () => projectApi.page(params),
  })
}

// Full-collection pulls for the analytics view (cached 10 min).
export function useAllListings() {
  return useQuery({
    queryKey: ['all-listings'],
    queryFn: () => crawl(listingApi.page),
    staleTime: 10 * 60 * 1000,
  })
}

export function useAllRentals() {
  return useQuery({
    queryKey: ['all-rentals'],
    queryFn: () => crawl(rentalApi.page),
    staleTime: 10 * 60 * 1000,
  })
}

export function useAllProjects() {
  return useQuery({
    queryKey: ['all-projects'],
    queryFn: () => crawl(projectApi.page),
    staleTime: 10 * 60 * 1000,
  })
}