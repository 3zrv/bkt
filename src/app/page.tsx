import { redirect } from "next/navigation"

export default function HomePage() {
  if (process.env.SANDBOX_MODE) {
    redirect("/sandbox")
  }
  redirect("/dashboard")
}
