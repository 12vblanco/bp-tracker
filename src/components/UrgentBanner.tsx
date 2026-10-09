import type { Urgency } from '../domain/classify'

/**
 * Shown the moment a crisis-range value is typed, before anything is saved.
 *
 * The symptom list appears at both tiers rather than only the higher one.
 * Guidelines separate hypertensive urgency from emergency by target-organ
 * symptoms, which a cuff cannot detect — so the numbers decide how loudly to
 * speak, and the person reading it decides whether the symptoms apply.
 *
 * No dismiss control. This is the one thing in the app that should be harder to
 * ignore than to act on.
 */
export function UrgentBanner({ urgency }: { urgency: Urgency }) {
  if (urgency === 'none') return null

  return (
    <div className="banner" role="alert">
      <h2>
        {urgency === 'emergency'
          ? 'This reading is in the crisis range'
          : 'This reading is severely high'}
      </h2>

      <p>
        {urgency === 'emergency'
          ? 'Contact your doctor or an urgent care service now, even if you feel well.'
          : 'Contact your doctor without delay. Rest for five minutes and measure again to confirm.'}
      </p>

      <p>
        <strong>Call emergency services</strong> if you also have any of:
      </p>
      <ul>
        <li>Chest pain or pressure</li>
        <li>Shortness of breath</li>
        <li>Sudden weakness, numbness, or trouble speaking</li>
        <li>Blurred vision or a severe headache</li>
        <li>Back pain</li>
      </ul>
    </div>
  )
}
