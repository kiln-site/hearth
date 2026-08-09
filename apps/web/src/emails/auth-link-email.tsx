import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Preview,
  Section,
  Tailwind,
  Text,
  pixelBasedPreset,
} from "@react-email/components"

export interface AuthLinkEmailProps {
  url: string
}

export function AuthLinkEmail({ url }: AuthLinkEmailProps) {
  return (
    <Html lang="en">
      <Tailwind
        config={{
          presets: [pixelBasedPreset],
          theme: {
            extend: {
              colors: {
                ember: "#dc6b38",
                ink: "#181614",
                smoke: "#716b64",
                paper: "#f4efe7",
              },
            },
          },
        }}
      >
        <Head />
        <Body className="bg-paper text-ink m-0 px-4 py-10 font-sans">
          <Preview>Confirm your Kiln email address</Preview>
          <Container className="mx-auto max-w-[560px] overflow-hidden rounded-xl border border-solid border-[#d9d0c4] bg-white">
            <Section className="border-b border-none border-solid border-[#e6ded4] px-8 py-6">
              <Text className="text-ember m-0 font-mono text-[11px] font-bold tracking-[0.18em] uppercase">
                Kiln · Email change
              </Text>
            </Section>
            <Section className="px-8 py-8">
              <Heading
                as="h1"
                className="text-ink m-0 text-[28px] leading-[34px]"
              >
                Confirm your new email
              </Heading>
              <Text className="text-smoke mt-5 text-[15px] leading-[24px]">
                Use the button below to verify this address and finish updating
                your Kiln account.
              </Text>
              <Button
                href={url}
                className="bg-ember my-6 inline-block rounded-lg px-5 py-3 text-[14px] font-bold text-white no-underline"
              >
                Verify email address
              </Button>
              <Text className="text-smoke text-[12px] leading-[19px]">
                This link expires in 10 minutes and can only be used once.
              </Text>
              <Hr className="my-6 border-0 border-t border-solid border-[#e6ded4]" />
              <Text className="m-0 text-[12px] leading-[19px] text-[#8e877f]">
                If you didn&apos;t request this change, you can safely ignore
                this email. Your current address will remain unchanged.
              </Text>
            </Section>
          </Container>
        </Body>
      </Tailwind>
    </Html>
  )
}

AuthLinkEmail.PreviewProps = {
  url: "https://kiln.example/api/auth/verify-email?token=preview",
} satisfies AuthLinkEmailProps

export default AuthLinkEmail
