import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { docsStyles as s } from "@/components/docs/Docs";
import { NOTICES_MD } from "@/generated/notices";

/** THIRD_PARTY_NOTICES.md, rendered: Fables' assets, fonts and the npm packages' licences. */
export default function CreditsPage() {
  return (
    <article className={s.main} style={{ margin: "8px auto 0", width: "100%" }}>
      <Markdown remarkPlugins={[remarkGfm]}>{NOTICES_MD}</Markdown>
    </article>
  );
}
