"use client"

import { useEffect, useMemo, useState } from "react"
import { endOfMonth, format, startOfMonth } from "date-fns"

const STORAGE_KEY = "exclusive-shared-period"

type SharedPeriodState = {
  from: string
  to: string
}

function getDefaultPeriod() {
  const now = new Date()
  return {
    from: format(startOfMonth(now), "yyyy-MM-dd"),
    to: format(endOfMonth(now), "yyyy-MM-dd"),
  }
}

export function useSharedPeriod() {
  const defaultPeriod = useMemo(() => getDefaultPeriod(), [])
  const [from, setFromState] = useState(defaultPeriod.from)
  const [to, setToState] = useState(defaultPeriod.to)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY)
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<SharedPeriodState>
        if (parsed.from) {
          setFromState(parsed.from)
        }
        if (parsed.to) {
          setToState(parsed.to)
        }
      }
    } catch (error) {
      console.error("shared period restore error", error)
    } finally {
      setReady(true)
    }
  }, [])

  useEffect(() => {
    if (!ready) return
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ from, to }))
    } catch (error) {
      console.error("shared period persist error", error)
    }
  }, [from, to, ready])

  const setFrom = (value: string) => setFromState(value || defaultPeriod.from)

  const setTo = (value: string) => setToState(value || defaultPeriod.to)

  return {
    from,
    to,
    setFrom,
    setTo,
    ready,
  }
}
