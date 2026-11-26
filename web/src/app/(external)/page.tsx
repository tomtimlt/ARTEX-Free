import { redirect } from "next/navigation";

import { MOCK } from "@/lib/mock/enabled";

export default function Home() {
  redirect(MOCK ? "/station-corail.html" : "/function/tasks");
}
