const LOCAL_SESSION = {
  user: {
    id: "local",
    role: "admin",
    name: "Local User",
    email: "local@localhost",
  },
  expires: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
}

export async function auth() {
  return LOCAL_SESSION
}
