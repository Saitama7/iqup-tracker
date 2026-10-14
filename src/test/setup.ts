import '@testing-library/jest-dom/vitest'
import { configure } from '@testing-library/react'

// Radix sheets/popovers animate in; under a full parallel run (CI, other agents) 1 s for
// findBy*/waitFor was flaky (date-picker «Ввести вручную»). 5 s only matters when something is slow.
configure({ asyncUtilTimeout: 5000 })
