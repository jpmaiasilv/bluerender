import { useEffect } from 'react';
import { useLanguage } from '../i18n';
import { PLANS } from '../config/plans';
import { SalesHeader } from '../components/sales/SalesHeader';
import { HeroSection } from '../components/sales/HeroSection';
import { SoftwareCompatibility } from '../components/sales/SoftwareCompatibility';
import { InteractiveDemo } from '../components/sales/InteractiveDemo';
import { WorkflowSection } from '../components/sales/WorkflowSection';
import { ProductShowcase } from '../components/sales/ProductShowcase';
import { PreservationSection } from '../components/sales/PreservationSection';
import { FeaturesSection } from '../components/sales/FeaturesSection';
import { ModelSelectorShowcase } from '../components/sales/ModelSelectorShowcase';
import { CloudSection } from '../components/sales/CloudSection';
import { WorkflowComparison } from '../components/sales/WorkflowComparison';
import { GallerySection } from '../components/sales/GallerySection';
import { AudienceSection } from '../components/sales/AudienceSection';
import { ResultsSection } from '../components/sales/ResultsSection';
import { PlanRecommender } from '../components/sales/PlanRecommender';
import { PricingSection } from '../components/sales/PricingSection';
import { FaqSection } from '../components/sales/FaqSection';
import { FinalCta } from '../components/sales/FinalCta';
import { SalesFooter } from '../components/sales/SalesFooter';
import { trackEvent } from '../lib/analytics/trackEvent';

const META_TAG_IDS = ['sales-meta-description', 'sales-og-title', 'sales-og-description', 'sales-og-type', 'sales-twitter-card', 'sales-faq-jsonld', 'sales-software-jsonld'];

function setMetaTag(id: string, attrs: Record<string, string>) {
  let el = document.getElementById(id) as HTMLMetaElement | null;
  if (!el) {
    el = document.createElement('meta');
    el.id = id;
    document.head.appendChild(el);
  }
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
}

function setJsonLd(id: string, data: unknown) {
  let el = document.getElementById(id) as HTMLScriptElement | null;
  if (!el) {
    el = document.createElement('script');
    el.id = id;
    el.type = 'application/ld+json';
    document.head.appendChild(el);
  }
  el.textContent = JSON.stringify(data);
}

/**
 * Public sales page — deliberately OUTSIDE ProtectedRoute in App.tsx (see
 * routing). Sets its own document title/meta tags on mount and restores the
 * app's default title on unmount, since this is the only route with
 * page-specific SEO — every other route just uses index.html's static title.
 */
export function SalesPage() {
  const { messages } = useLanguage();
  const t = messages.sales;

  useEffect(() => {
    trackEvent('landing_page_view');
  }, []);

  useEffect(() => {
    const originalTitle = document.title;
    document.title = t.meta.title;

    setMetaTag('sales-meta-description', { name: 'description', content: t.meta.description });
    setMetaTag('sales-og-title', { property: 'og:title', content: t.meta.title });
    setMetaTag('sales-og-description', { property: 'og:description', content: t.meta.description });
    setMetaTag('sales-og-type', { property: 'og:type', content: 'website' });
    setMetaTag('sales-twitter-card', { name: 'twitter:card', content: 'summary_large_image' });

    setJsonLd('sales-faq-jsonld', {
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: t.faq.items.map((item) => ({
        '@type': 'Question',
        name: item.q,
        acceptedAnswer: { '@type': 'Answer', text: item.a },
      })),
    });

    const cheapestPlan = [...PLANS].sort((a, b) => a.pricing.BRL.monthlyPrice - b.pricing.BRL.monthlyPrice)[0];
    setJsonLd('sales-software-jsonld', {
      '@context': 'https://schema.org',
      '@type': 'SoftwareApplication',
      name: 'Blue Render',
      applicationCategory: 'DesignApplication',
      operatingSystem: 'Web',
      offers: { '@type': 'Offer', price: cheapestPlan.pricing.BRL.monthlyPrice, priceCurrency: 'BRL' },
    });

    return () => {
      document.title = originalTitle;
      for (const id of META_TAG_IDS) document.getElementById(id)?.remove();
    };
  }, [t]);

  return (
    <div className="min-h-screen bg-surface">
      <SalesHeader />
      <main>
        <HeroSection />
        <SoftwareCompatibility />
        <InteractiveDemo />
        <WorkflowSection />
        <ProductShowcase />
        <PreservationSection />
        <FeaturesSection />
        <ModelSelectorShowcase />
        <CloudSection />
        <WorkflowComparison />
        <GallerySection />
        <AudienceSection />
        <ResultsSection />
        <PlanRecommender />
        <PricingSection />
        <FaqSection />
        <FinalCta />
      </main>
      <SalesFooter />
    </div>
  );
}
