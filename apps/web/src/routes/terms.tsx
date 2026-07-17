import { createFileRoute } from "@tanstack/react-router"

import { LegalList, LegalPage, LegalSection } from "@/components/legal-page"
import { pageTitle } from "@/lib/page-title"

export const Route = createFileRoute("/terms")({
  head: () => ({ meta: [{ title: pageTitle("Terms of Use") }] }),
  component: TermsRoute,
})

function TermsRoute() {
  return (
    <LegalPage title="Terms of Use" updated="July 15, 2026">
      <LegalSection title="Using Hearth">
        <p>
          These Terms govern your use of Hearth Panel, the Kiln control plane
          operated by QuartzDev. Hearth connects to Relays and helps you manage
          game server instances, files, logs, and console access.
        </p>
        <p>
          By signing in to or using Hearth, you agree to these Terms. If you do
          not agree, do not use the panel.
        </p>
      </LegalSection>

      <LegalSection title="Accounts and access">
        <p>
          Keep your account details, passwords, session credentials, and Relay
          tokens secure. You are responsible for activity performed through
          your account and for granting the right people access to your
          instances.
        </p>
      </LegalSection>

      <LegalSection title="Your servers and content">
        <p>
          You keep ownership of the servers, files, logs, commands, and other
          content you connect to or submit through Hearth. You are responsible
          for that content, its legality, and your right to use it.
        </p>
      </LegalSection>

      <LegalSection title="Acceptable use">
        <p>Do not use Hearth or a connected Relay to:</p>
        <LegalList>
          <li>break the law or infringe another person’s rights;</li>
          <li>bypass access controls, probe, attack, or disrupt systems;</li>
          <li>distribute malware, abuse, spam, or unauthorized content; or</li>
          <li>interfere with Hearth, its Relays, or another user’s service.</li>
        </LegalList>
      </LegalSection>

      <LegalSection title="Availability and changes">
        <p>
          Hearth is a control plane, not a promise that a connected game server
          or Relay will be available. Deployments, nodes, runtimes, backups, and
          retention may be managed by you or another operator. We may change,
          suspend, or discontinue Hearth for maintenance, security, or a Terms
          violation.
        </p>
      </LegalSection>

      <LegalSection title="Software and third parties">
        <p>
          Hearth and its dependencies may be provided under open-source
          licenses; those licenses continue to apply. Minecraft, mods, plugins,
          game runtimes, Relays, and linked services have their own terms and
          are not operated by Hearth unless we say otherwise.
        </p>
      </LegalSection>

      <LegalSection title="Disclaimers and liability">
        <p>
          Hearth is provided “as is” and “as available.” To the maximum extent
          permitted by law, QuartzDev is not responsible for indirect losses,
          downtime, or lost content resulting from your use of Hearth or a
          connected service. Nothing in these Terms limits rights that cannot be
          limited by law.
        </p>
      </LegalSection>

      <LegalSection title="Updates and contact">
        <p>
          We may update these Terms by posting a new version here. Continued use
          after an update means you accept the revised Terms. Questions can be
          raised through the Discord link in the panel footer.
        </p>
      </LegalSection>
    </LegalPage>
  )
}
