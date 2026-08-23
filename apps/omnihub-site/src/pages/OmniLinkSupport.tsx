import { SEOMeta } from '@/components/SEOMeta';
import { Layout } from '@/components/Layout';
import { SupportChat } from '@/components/support/SupportChat';

export function OmniLinkSupportPage() {
  return (
    <Layout title="OmniLink Support">
      <SEOMeta
        title="OmniLink Support | APEX OmniHub"
        description="Get help with the OmniLink iOS and Android App. Chat with our AI support agent, browse FAQs, or contact our team directly."
      />

      <div
        style={{
          paddingTop: '100px',
          paddingBottom: '80px',
          minHeight: '100vh',
          background: 'var(--color-bg, #060d1a)',
          fontFamily: 'var(--font, "Space Grotesk", sans-serif)',
        }}
      >
        <div
          style={{
            maxWidth: '1100px',
            margin: '0 auto',
            padding: '0 24px',
          }}
        >
          <div style={{ marginBottom: '48px' }}>
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
                background: 'rgba(196,81,26,0.12)',
                border: '1px solid rgba(196,81,26,0.3)',
                borderRadius: '24px',
                padding: '6px 14px',
                fontSize: '12px',
                fontWeight: 700,
                color: '#C4511A',
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                marginBottom: '20px',
              }}
            >
              <div
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: '50%',
                  background: '#22c55e',
                  boxShadow: '0 0 8px rgba(34,197,94,0.7)',
                  animation: 'pulse 2s infinite',
                }}
              />
              Mobile App Support
            </div>
            <h1
              style={{
                fontSize: 'clamp(2rem, 5vw, 3.5rem)',
                fontWeight: 800,
                color: '#fff',
                margin: '0 0 16px',
                lineHeight: 1.1,
              }}
            >
              OmniLink{' '}
              <span style={{ color: '#C4511A' }}>Support</span>
            </h1>
            <p
              style={{
                fontSize: 'clamp(1rem, 2vw, 1.2rem)',
                color: 'rgba(255,255,255,0.55)',
                maxWidth: '560px',
                lineHeight: 1.6,
                margin: 0,
              }}
            >
              Dedicated support for the OmniLink native mobile application. Ask our AI support agent anything, or reach a human directly.
            </p>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(0, 1.5fr) minmax(0, 1fr)',
              gap: '32px',
              alignItems: 'start',
            }}
          >
            <SupportChat />

            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              <div
                style={{
                  background: 'rgba(255,255,255,0.03)',
                  border: '1px solid rgba(255,255,255,0.09)',
                  borderRadius: '16px',
                  padding: '24px',
                }}
              >
                <div style={{ fontSize: '20px', marginBottom: '8px' }}>📧</div>
                <h3
                  style={{
                    fontSize: '16px',
                    fontWeight: 700,
                    color: '#fff',
                    margin: '0 0 8px',
                  }}
                >
                  Email Support
                </h3>
                <p
                  style={{
                    fontSize: '13px',
                    color: 'rgba(255,255,255,0.5)',
                    margin: '0 0 16px',
                    lineHeight: 1.6,
                  }}
                >
                  Our team responds within 24 hours on business days.
                </p>
                <a
                  href="mailto:support@apex-systems.com"
                  style={{
                    display: 'inline-block',
                    padding: '8px 18px',
                    background: '#C4511A',
                    color: '#fff',
                    borderRadius: '8px',
                    textDecoration: 'none',
                    fontSize: '13px',
                    fontWeight: 700,
                  }}
                >
                  support@apex-systems.com
                </a>
              </div>

              {/* Legal & Policies */}
              <div
                style={{
                  background: 'rgba(255,255,255,0.02)',
                  border: '1px solid rgba(255,255,255,0.07)',
                  borderRadius: '16px',
                  padding: '20px 24px',
                }}
              >
                <h3
                  style={{
                    fontSize: '13px',
                    fontWeight: 700,
                    color: 'rgba(255,255,255,0.5)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.06em',
                    margin: '0 0 12px',
                  }}
                >
                  Policies & Legal
                </h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {[
                    { label: 'OmniLink Privacy Policy', href: '/omnilink-privacy' },
                    { label: 'Terms of Service', href: '/terms' },
                  ].map((link) => (
                    <a
                      key={link.href}
                      href={link.href}
                      style={{
                        color: 'rgba(255,255,255,0.6)',
                        fontSize: '13px',
                        textDecoration: 'none',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                      }}
                    >
                      <span style={{ color: '#C4511A' }}>›</span> {link.label}
                    </a>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* App info block (required for App Store compliance) */}
          <section
            aria-label="App information"
            style={{
              marginTop: '60px',
              padding: '32px',
              background: 'rgba(255,255,255,0.02)',
              border: '1px solid rgba(255,255,255,0.07)',
              borderRadius: '20px',
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
              gap: '24px',
            }}
          >
            {[
              { label: 'Developer', value: 'APEX Business Systems LTD' },
              { label: 'Category', value: 'Business / Productivity' },
              { label: 'Support Email', value: 'support@apex-systems.com' },
              { label: 'App Privacy Policy', value: 'apexomnihub.icu/omnilink-privacy' },
            ].map((item) => (
              <div key={item.label}>
                <div
                  style={{
                    fontSize: '10px',
                    textTransform: 'uppercase',
                    letterSpacing: '0.08em',
                    color: 'rgba(255,255,255,0.35)',
                    marginBottom: '4px',
                    fontWeight: 700,
                  }}
                >
                  {item.label}
                </div>
                <div style={{ fontSize: '13.5px', color: 'rgba(255,255,255,0.75)' }}>
                  {item.value}
                </div>
              </div>
            ))}
          </section>
        </div>
      </div>
    </Layout>
  );
}
