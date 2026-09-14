import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { savedApi } from '../api/saved'

export function useSavedIds() {
  const { data } = useQuery({
    queryKey: ['saved'],
    queryFn: () => savedApi.list(),
    retry: false,
  })
  return new Set((data?.rows || []).map((r) => String(r.listing_id)))
}

export function useSavedRows() {
  return useQuery({
    queryKey: ['saved'],
    queryFn: () => savedApi.list(),
    retry: false,
  })
}

export function useToggleSaved() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (listing) => {
      const id = listing.listing_id
      return savedApi.has(id) ? savedApi.remove(id) : savedApi.add(listing)
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['saved'] }),
  })
}

export function useRemoveSaved() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id) => savedApi.remove(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['saved'] }),
  })
}