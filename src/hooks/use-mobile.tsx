import * as React from "react"

// Where the editor's side panels stop being columns and become overlays.
// Not a phone/not-a-phone line: it is the width below which the palette (288px)
// and the properties dock (320px) leave the canvas too narrow to work in. A
// portrait iPad is 834px, which is on the wrong side of it.
const MOBILE_BREAKPOINT = 1024

export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState<boolean | undefined>(undefined)

  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
    const onChange = () => {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
    }
    mql.addEventListener("change", onChange)
    setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
    return () => mql.removeEventListener("change", onChange)
  }, [])

  return !!isMobile
}
