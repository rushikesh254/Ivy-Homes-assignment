import { FAKE_LISTINGS, BROKEN_LISTINGS, COPY_LISTINGS, FAKE_CONTACTS } from '../data/findings'
import { Tag } from './primitives'

function has(xs, id) {
  return xs.has(String(id))
}

/**
 * Surface the forensics findings directly on a record:
 *  - COPY_LISTINGS  -> duplicate of an already-counted property
 *  - FAKE_LISTINGS  -> posted under a shared contact (fake-listings plant)
 *  - BROKEN_LISTINGS-> describes something that cannot exist
 */
export function FindingTags({ listing }) {
  const id = listing?.listing_id
  const notes = []
  if (id != null && has(COPY_LISTINGS, id)) notes.push(<Tag key="d" tone="amber">Duplicate</Tag>)
  if (id != null && has(FAKE_LISTINGS, id)) notes.push(<Tag key="f" tone="red">Suspected fake</Tag>)
  if (id != null && has(BROKEN_LISTINGS, id)) notes.push(<Tag key="c" tone="red">Data anomaly</Tag>)
  if (listing?.posted_by_contact && FAKE_CONTACTS.includes(listing.posted_by_contact)) {
    notes.push(<Tag key="p" tone="red">Shared contact</Tag>)
  }
  return <>{notes}</>
}

export function findingNotes(listing) {
  const id = listing?.listing_id
  const notes = []
  if (id != null && has(BROKEN_LISTINGS, id)) {
    notes.push('This record describes something that cannot exist (verified data anomaly).')
  }
  if (id != null && has(FAKE_LISTINGS, id)) {
    notes.push('This listing is posted under a contact that is shared across many names and localities — a known fake-listings signal.')
  }
  if (id != null && has(COPY_LISTINGS, id)) {
    notes.push('This record re-describes a property that is already counted once in the dataset.')
  }
  if (listing?.posted_by_contact && FAKE_CONTACTS.includes(listing.posted_by_contact)) {
    notes.push('This contact number is shared by multiple posted-by names — treat enquiries with caution.')
  }
  return notes
}