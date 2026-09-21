import {
  ErrorCode,
  EnvironmentOption,
  IdeaAtmosphere,
  IdeaCamera,
  IdeaCreativity,
  IdeaEngineTier,
  IdeaEnvironment,
  IdeaGoal,
  IdeaLighting,
  IdeaMaterialPreset,
  IdeaStyle,
  LedOption,
  LightingOption,
  HumanizedFloorplanSimpleStyle, HumanizedFloorplanLighting, HumanizedFloorplanSurroundings, HumanizedFloorplanSurroundingsKind, HumanizedFloorplanTextMode, HumanizedFloorplanFurnitureLevel, HumanizedFloorplanOutputFormat,
  PlantaEngineTier,
  PlantaRenderStyle,
  PreservationLevel,
  PreserveLevel,
  ProjectType,
  RenderStyleOption,
  T2IAspectRatio,
  T2ICreativity,
  T2IEngineTier,
  T2ILighting,
  T2IProjectType,
  T2IStyle,
  TransformationLevel,
} from '../types';
import { IdeaSpaceKey } from '../lib/options';
import { PlanFeatureKey, PlanId, PlanPriority } from '../config/plans';
import { SettingsSectionId } from '../config/settingsSections';
import { AuthErrorKey } from '../lib/auth/errors';
import { SupportCategory, SupportStatus } from '../lib/support/types';
import { UpdateTag } from '../config/updates';
import { ProjectFileCategory } from '../lib/projectFiles/types';

export type Locale = 'en' | 'pt' | 'es';

/** Every planned tool, including the ones with no working backend yet ("coming soon"). */
export type ToolId =
  | 'render'
  | 'plantaHumanizada'
  | 'imagemPorTexto'
  | 'ideaGenerator'
  | 'videoIa'
  | 'videoEditor'
  | 'melhorarRender'
  | 'multiangulo'
  | 'upscale'
  | 'editorIa'
  | 'arquitetoEstagiario'
  | 'financial'
  | 'projectFlow';

export interface Messages {
  common: {
    close: string;
  };
  header: {
    brand: string;
  };
  nav: {
    groups: {
      home: string;
      create: string;
      edit: string;
      assist: string;
      management: string;
      library: string;
    };
    items: {
      home: string;
      meusProjetos: string;
      historico: string;
      ajuda: string;
      configuracoes: string;
    } & Record<ToolId, string>;
    comingSoonBadge: string;
    premiumBadge: string;
    /** e.g. "Available on Pro" — shown as the tooltip on a premium tool's gold indicator. */
    premiumTooltip: (planName: string) => string;
    /** Fallback tooltip when a premium tool has no specific `requiredPlan` set. */
    premiumGenericTooltip: string;
    collapseSidebar: string;
    expandSidebar: string;
  };
  profileMenu: {
    changeLanguage: string;
    helpAndFeedback: string;
    settings: string;
    logout: string;
  };
  auth: {
    login: {
      title: string;
      subtitle: string;
      emailLabel: string;
      emailPlaceholder: string;
      passwordLabel: string;
      passwordPlaceholder: string;
      submit: string;
      submitting: string;
      forgotPassword: string;
      noAccount: string;
      createAccount: string;
      orDivider: string;
      googleCta: string;
    };
    signup: {
      title: string;
      subtitle: string;
      nameLabel: string;
      namePlaceholder: string;
      emailLabel: string;
      emailPlaceholder: string;
      passwordLabel: string;
      passwordPlaceholder: string;
      passwordHint: string;
      submit: string;
      submitting: string;
      haveAccount: string;
      signIn: string;
      orDivider: string;
      googleCta: string;
      confirmEmailTitle: string;
      confirmEmailMessage: string;
      backToLogin: string;
    };
    forgotPassword: {
      title: string;
      subtitle: string;
      emailLabel: string;
      emailPlaceholder: string;
      submit: string;
      submitting: string;
      sentTitle: string;
      sentMessage: string;
      backToLogin: string;
    };
    resetPassword: {
      title: string;
      subtitle: string;
      newPasswordLabel: string;
      confirmPasswordLabel: string;
      submit: string;
      submitting: string;
      successTitle: string;
      successMessage: string;
      goToApp: string;
      invalidLinkTitle: string;
      invalidLinkMessage: string;
      backToLogin: string;
      passwordMismatch: string;
    };
    callback: {
      processing: string;
      errorTitle: string;
      backToLogin: string;
    };
    errors: Record<AuthErrorKey, string>;
  };
  migration: {
    foundTitle: string;
    foundBody: string;
    syncCta: string;
    dismissCta: string;
    syncing: string;
    doneTitle: string;
    errorTitle: string;
    retryCta: string;
  };
  upgrade: {
    button: string;
  };
  home: {
    greeting: string;
    subtitle: string;
    createSection: string;
    improveSection: string;
    hero: {
      title: string;
      description: string;
      ctaPrimary: string;
      ctaSecondary: string;
      compareOriginal: string;
      compareRender: string;
    };
    recentProjects: {
      title: string;
      viewAll: string;
      emptyTitle: string;
      emptyCta: string;
    };
  };
  toolDescriptions: Record<ToolId, string>;
  comingSoon: {
    badge: string;
    title: string;
    message: string;
    backToHome: string;
  };
  projects: {
    title: string;
    subtitle: string;
    empty: string;
  };
  helpPage: {
    title: string;
    subtitle: string;
    contact: {
      title: string;
      description: string;
      categoryLabel: string;
      categoryOptions: Record<SupportCategory, string>;
      subjectLabel: string;
      subjectPlaceholder: string;
      messageLabel: string;
      messagePlaceholder: string;
      attachmentLabel: string;
      attachmentHint: string;
      attachmentDragText: string;
      submit: string;
      submitting: string;
      successTitle: string;
      successBody: string;
      errorGeneric: string;
    };
    history: {
      title: string;
      empty: string;
      statusLabels: Record<SupportStatus, string>;
      yourMessage: string;
      teamResponse: string;
      respondedOn: string;
      attachment: string;
      awaitingResponse: string;
    };
    updates: {
      title: string;
      description: string;
      tagLabels: Record<UpdateTag, string>;
      items: Record<string, { title: string; description: string }>;
    };
    shortcuts: {
      title: string;
      plans: { title: string; description: string };
      credits: { title: string; description: string };
      reportIssue: { title: string; description: string };
      suggestTool: { title: string; description: string };
    };
  };
  settings: {
    title: string;
    subtitle: string;
    notAvailable: string;
    saveChanges: string;
    savePersistenceNote: string;
    errorLoading: string;
    tryAgain: string;
    comingSoonBadge: string;
    comingSoonLockTooltip: string;
    nav: Record<SettingsSectionId, string>;
    profile: {
      title: string;
      accountInfo: string;
      name: string;
      email: string;
      phone: string;
      language: string;
      currentPlan: string;
    };
    personalData: {
      title: string;
      fullName: string;
      phone: string;
      phonePlaceholder: string;
      language: string;
      languageHint: string;
      email: string;
      saveSuccess: string;
    };
    office: {
      title: string;
      subtitle: string;
      nameLabel: string;
      namePlaceholder: string;
      save: string;
      saveSuccess: string;
      readOnlyNotice: string;
    };
    billing: {
      title: string;
      currentPlanCard: string;
      noActiveSubscription: string;
      noActiveSubscriptionHint: string;
      viewPlans: string;
      manageSubscription: string;
    };
    credits: {
      title: string;
      availableBalance: string;
      explanation1: string;
      explanation2: string;
      historyTitle: string;
      historyEmpty: string;
    };
    referrals: {
      title: string;
      cardTitle: string;
      cardBody: string;
    };
    preferences: {
      title: string;
      languageLabel: string;
    };
    sketchup: {
      title: string;
      description1: string;
      description2: string;
      step1: string;
      step2: string;
      step3: string;
      downloadButton: string;
      availableSoon: string;
    };
  };
  plans: {
    pageTitle: string;
    pageSubtitle: string;
    selectPlanLabel: string;
    billingToggle: {
      monthly: string;
      annual: string;
      annualBadge: string;
    };
    mostPopular: string;
    perMonth: string;
    monthlyBilling: string;
    billedAnnually: (amount: string) => string;
    freeMonths: string;
    savings: (amount: string) => string;
    creditsPerMonth: (n: number) => string;
    creditsChip: (n: number) => string;
    creditsRenewMonthly: string;
    /** "Up to N renders Fast/month" — always an upper bound, assumes 100% of credits spent on Render Fast only. */
    capacityLine: (n: number) => string;
    capacityTooltip: string;
    names: Record<PlanId, string>;
    descriptions: Record<PlanId, string>;
    features: Record<PlanFeatureKey, string>;
    heroMessage: Record<PlanId, string>;
    heroChipsExtra: Record<PlanId, string[]>;
    comingSoonSuffix: string;
    cta: Record<PlanId, string>;
    ctaRedirecting: string;
    checkoutErrors: {
      generic: string;
      forbidden: string;
      notConfigured: string;
      needsOrganization: string;
    };
    compareLink: string;
    compareTitle: string;
    compareRows: {
      monthlyCredits: string;
      renderIA: string;
      plantaHumanizada: string;
      imagemPorTexto: string;
      videoIa: string;
      multiangulo: string;
      melhorarRender: string;
      upscale: string;
      maxResolution: string;
      fast: string;
      pro: string;
      ultra: string;
      priority: string;
      earlyAccess: string;
      commercialUse: string;
      users: string;
    };
    priorityLevels: Record<PlanPriority, string>;
    comingSoonCell: string;
  };
  creditsDropdown: {
    currentBalance: string;
    buyCredits: string;
    buyCreditsComingSoon: string;
  };
  upload: {
    architecturalModel: string;
    dragDrop: string;
    formats: string;
    remove: string;
    unsupportedFormat: string;
    referenceRender: string;
    referenceRenderHint: string;
    referenceRenderDragDrop: string;
  };
  fields: {
    projectType: string;
    projectTypeOptions: Record<ProjectType, string>;
    preserveArchitecture: string;
    preserveArchitectureHint: string;
    preserveLevels: Record<PreserveLevel, string>;
    renderStyle: string;
    renderStyles: Record<RenderStyleOption, string>;
    lighting: string;
    lightingOptions: Record<LightingOption, string>;
    environment: string;
    environmentOptions: Record<EnvironmentOption, string>;
    led: string;
    ledOptions: Record<LedOption, string>;
    aspectRatio: string;
    aspectRatioOptions: Record<'automatic' | '16:9' | '4:3' | '3:2' | '1:1' | '9:16', string>;
    customInstructions: string;
    customInstructionsOptional: string;
    customInstructionsPlaceholder: string;
    advancedOptions: string;
  };
  engines: {
    title: string;
    tierNames: Record<'fast' | 'standard' | 'pro' | 'gpt_image' | 'nano_banana_2', string>;
    tierDescriptions: Record<'fast' | 'standard' | 'pro' | 'gpt_image' | 'nano_banana_2', string>;
    recommended: string;
    newBadge: string;
    legacyModels: string;
  };
  wallet: {
    creditsLabel: string;
    /** e.g. "1 credit" vs "2 credits" — same singular-at-1 pattern in en/pt/es. */
    creditsSuffix: (n: number) => string;
    addTestCredits: string;
    devBadge: string;
    insufficientMessage: (needed: number, balance: number) => string;
    balancePreview: (before: number, after: number) => string;
  };
  generate: {
    button: string;
    generating: string;
  };
  generatingStatus: {
    title: string;
    elapsed: string;
    steps: {
      preparing: string;
      analyzing: string;
      creating: string;
      finalizing: string;
    };
  };
  result: {
    placeholderTitle: string;
    placeholderHint: string;
    compare: string;
    original: string;
    aiRender: string;
    downloadRender: string;
    generateAgain: string;
    newImage: string;
    resolution: string;
  };
  devInfo: {
    title: string;
    engine: string;
    provider: string;
    model: string;
    generationTime: string;
    resolution: string;
    creditsCharged: string;
  };
  errors: {
    titles: Record<ErrorCode, string>;
    tryAgain: string;
    technicalDetails: string;
  };
  history: {
    recentTests: string;
    title: string;
    subtitle: string;
    empty: string;
    filters: {
      all: string;
      renders: string;
      plants: string;
      textImages: string;
      ideas: string;
      upscales: string;
      videos: string;
    };
    preview: {
      close: string;
      download: string;
      prompt: string;
    };
  };
  textToImage: {
    composer: {
      placeholder: string;
      helper: string;
      charCount: (current: number, max: number) => string;
    };
    quickChips: {
      title: string;
      residencial: string;
      interiores: string;
      comercial: string;
      paisagismo: string;
      fachadas: string;
      conceitual: string;
    };
    /** Field label for the Category select — the option labels themselves reuse `quickChips`. */
    categoryLabel: string;
    /** "Qualidade" — deliberately NOT `engines.title` ("Qualidade do Render"), which is Render IA-specific copy. */
    qualityLabel: string;
    engineTierNames: Record<T2IEngineTier, string>;
    engineTierDescriptions: Record<T2IEngineTier, string>;
    styleLabel: string;
    styles: Record<T2IStyle, string>;
    projectTypeLabel: string;
    projectTypes: Record<T2IProjectType, string>;
    lightingLabel: string;
    lightingOptions: Record<T2ILighting, string>;
    creativityLabel: string;
    creativityLevels: Record<T2ICreativity, string>;
    aspectRatioLabel: string;
    aspectRatioOptions: Record<T2IAspectRatio, string>;
    imageCount: {
      label: string;
      optionLabel: (n: number) => string;
    };
    reference: {
      label: string;
      hint: string;
      dragDrop: string;
    };
    inspireMe: string;
    completeDescription: string;
    completionPrefix: string;
    generateButton: (n: number, credits: number) => string;
    generating: string;
    emptyState: {
      title: string;
      subtitle: string;
      examples: string[];
    };
    loadingStatus: {
      title: string;
      steps: {
        preparing: string;
        analyzing: string;
        creating: string;
        finalizing: string;
      };
    };
    results: {
      partialNotice: (generated: number, requested: number) => string;
      download: string;
      useAsReference: string;
      variation: string;
      upscale: string;
      video: string;
      comingSoon: string;
    };
    toolbar: {
      history: string;
      new: string;
      reusePrompt: string;
    };
    insufficientCredits: string;
    inspiration: {
      buildingTypes: string[];
      styles: string[];
      materials: string[];
      settings: string[];
      moods: string[];
      template: (buildingType: string, style: string, material: string, setting: string, mood: string) => string;
    };
    crossSellToIdeaGenerator: {
      text: string;
      cta: string;
    };
  };
  ideaGenerator: {
    emptyState: {
      title: string;
      subtitle: string;
      createCta: string;
      reimagineCta: string;
    };
    examples: Record<string, string>;
    reference: {
      label: string;
      hint: string;
      dragDrop: string;
      change: string;
      remove: string;
    };
    environmentLabel: string;
    environments: Record<IdeaEnvironment, string>;
    spaceLabel: string;
    spaces: Record<IdeaSpaceKey, string>;
    spaceOtherPlaceholder: string;
    goalLabel: string;
    goals: Record<IdeaGoal, string>;
    styleLabel: string;
    styles: Record<IdeaStyle, string>;
    detailsLabel: string;
    detailsHint: string;
    detailsPlaceholder: string;
    engineLabel: string;
    engineTierNames: Record<IdeaEngineTier, string>;
    engineTierDescriptions: Record<IdeaEngineTier, string>;
    imageCount: {
      label: string;
      optionLabel: (n: number) => string;
    };
    preservationLabel: string;
    preservationHint: string;
    preservationLevels: Record<PreservationLevel, string>;
    transformationLabel: string;
    transformationLevels: Record<TransformationLevel, string>;
    lightingLabel: string;
    lightingOptions: Record<IdeaLighting, string>;
    cameraLabel: string;
    cameraOptions: Record<IdeaCamera, string>;
    cameraPreserveNote: string;
    atmosphereLabel: string;
    atmosphereOptions: Record<IdeaAtmosphere, string>;
    materialsLabel: string;
    materialOptions: Record<IdeaMaterialPreset, string>;
    /** Distinct wording from `fields.environment` ("Ambiente") on purpose — this tool already uses that exact label for its own environment field (space type: interior/exterior/...), so the shared surrounding-context control (same EnvironmentOption values as Render IA) needs its own, unambiguous label here. */
    surroundingsLabel: string;
    creativityLabel: string;
    creativityLevels: Record<IdeaCreativity, string>;
    generateButton: (n: number, credits: number) => string;
    generating: string;
    loadingStatus: {
      title: string;
      steps: {
        preparing: string;
        exploring: string;
        creating: string;
        finalizing: string;
      };
    };
    results: {
      partialNotice: (generated: number, requested: number) => string;
      download: string;
      reuseSettings: string;
      variation: string;
      useAsNewBase: string;
      continueExploring: string;
      compareWithOriginal: string;
      before: string;
      after: string;
      upscale: string;
      video: string;
      improveRender: string;
      comingSoon: string;
    };
    toolbar: {
      history: string;
      new: string;
    };
    insufficientCredits: string;
    quickChips: {
      title: string;
      interiores: string;
      fachadas: string;
      paisagismo: string;
      comercial: string;
      residencial: string;
    };
    crossSellToTextToImage: {
      text: string;
      cta: string;
    };
  };
  plantaHumanizada: {
    qualityLabel: string;
    engineTierNames: Record<PlantaEngineTier, string>;
    engineTierDescriptions: Record<PlantaEngineTier, string>;
    renderStyleLabel: string;
    renderStyles: Record<PlantaRenderStyle, string>;
    promptLabel: string;
    promptPlaceholder: string;
    autoPromptButton: string;
    autoPromptComingSoon: string;
    uploadLabel: string;
    uploadDragDrop: string;
    reference: {
      label: string;
      hint: string;
      dragDrop: string;
    };
    generateButton: string;
    generating: string;
    cleanupButton: string;
    cleanupButtonLoading: string;
    cleanupHistoryLabel: string;
    cleanupAppliedLabel: string;
    cleanupAppliedYes: string;
    toolbar: {
      history: string;
      new: string;
    };
    editButton: string;
    simpleFlow: {
      styleLabel: string;
      styles: Record<HumanizedFloorplanSimpleStyle, string>;
      lightingLabel: string;
      lighting: Record<HumanizedFloorplanLighting, string>;
      surroundingsLabel: string;
      surroundings: Record<HumanizedFloorplanSurroundings, string>;
      surroundingsKindLabel: string;
      surroundingsKinds: Record<HumanizedFloorplanSurroundingsKind, string>;
      customSurroundingsPlaceholder: string;
      referenceLabel: string;
      referenceHint: string;
      referenceDragDrop: string;
      referenceBadge: string;
      originalBadge: string;
      replaceFile: string;
      fileTooLarge: (maxMb: number) => string;
      instructionsLabel: string;
      instructionsPlaceholder: string;
      advancedLabel: string;
      textModeLabel: string;
      textModes: Record<HumanizedFloorplanTextMode, string>;
      furnitureLabel: string;
      furnitureLevels: Record<HumanizedFloorplanFurnitureLevel, string>;
      outputFormatLabel: string;
      outputFormats: Record<HumanizedFloorplanOutputFormat, string>;
      costNotice: (credits: number) => string;
      astraCostNotice: (credits: number) => string;
      astraGenerateButton: (credits: number) => string;
      modeLabel: string;
      modes: {
        standard: { title: string; description: string; costLabel: (credits: number) => string };
        astra: { title: string; badge: string; description: string; costLabel: (credits: number) => string; comingSoon: string };
      };
      astraStages: { analyzing_architecture: string; preparing: string; generating: string; finalizing: string };
      costLoading: string;
      balanceNotice: (balance: number, after: number) => string;
      generateButton: (credits: number) => string;
      generateButtonLoading: string;
      generating: string;
      processingTitle: string;
      processingElapsed: string;
      stages: { uploading: string; analyzing: string; generating: string; finalizing: string };
      failureNoCharge: string;
      errorMessages: Record<string, string>;
      againButton: string;
      newPlanButton: string;
      downloadPng: string;
      downloadJpg: string;
      confirmTitle: string;
      confirmBody: (credits: number, balance: number, after: number) => string;
      cancel: string;
      confirmAction: string;
      newVersionApplied: string;
      history: {
        title: string;
        empty: string;
        loading: string;
        loadError: string;
        retry: string;
        status: { processing: string; completed: string; failed: string };
        creditsUsed: (credits: number) => string;
        withReference: string;
        withoutReference: string;
        notInformed: string;
        modeStandard: string;
        modeAstra: string;
        fileLabel: string;
        styleLabel: string;
        lightingLabel: string;
        surroundingsLabel: string;
      };
      modal: {
        title: string;
        tabResult: string;
        tabOriginal: string;
        tabCompare: string;
        before: string;
        after: string;
        newVersion: string;
        repeat: string;
        deleteAction: string;
        deleteConfirm: string;
        deleteFailed: string;
        close: string;
        noImage: string;
      };
    };
    generatingStatus: {
      title: string;
      elapsed: string;
      steps: {
        analyzingStructure: string;
        recognizingFurniture: string;
        refiningObjects: string;
        humanizing: string;
        validating: string;
      };
    };
    maskReview: {
      title: string;
      loadingMask: string;
      loadingMaskFailed: string;
      legendProtected: string;
      legendEditable: string;
      protectedPercent: (n: number) => string;
      editablePercent: (n: number) => string;
      coverageWarning: string;
      opacityLabel: string;
      zoomIn: string;
      zoomOut: string;
      fitToScreen: string;
      fullscreen: string;
      exitFullscreen: string;
      toolProtect: string;
      toolAllow: string;
      toolPan: string;
      brushSizeLabel: string;
      undo: string;
      redo: string;
      restoreAutoMask: string;
      clearManualEdits: string;
      confirmCheckboxLabel: (credits: number) => string;
      balanceLabel: (balance: number) => string;
      confirmButton: string;
      confirmButtonSubmitting: string;
      cancelButton: string;
      dimensionMismatch: string;
      rejectedTitle: string;
      rejectedHint: string;
    };
  };
  plantaEditor: {
    title: string;
    backToPlanta: string;
    toolbar: {
      select: string;
      move: string;
      erase: string;
      copy: string;
      save: string;
      saved: string;
      undo: string;
      redo: string;
      export: string;
      exportPng: string;
      exportJpg: string;
      exportPdf: string;
    };
    editMenu: {
      title: string;
      select: string;
      annotate: string;
      removeObject: string;
      outpaint: string;
      addPeople: string;
      swapMaterial: string;
      changeTimeOfDay: string;
      changeFlooring: string;
      addShadow: string;
      addManualCaption: string;
      addAutoCaption: string;
      comingSoon: string;
    };
    plantaTools: {
      title: string;
      numberRooms: string;
      roomName: string;
      scaleBar: string;
      scaleBarValueLabel: string;
      maskBrush: string;
      maskBrushHint: string;
      brushSize: string;
      brushOpacity: string;
    };
    emptyStateHint: string;
    pasteOrUploadHint: string;
    defaultRoomName: string;
    cancel: string;
    confirm: string;
  };
  videoGenerator: {
    composer: {
      placeholder: string;
      helper: string;
      charCount: (current: number, max: number) => string;
    };
    sourceImage: {
      label: string;
      hint: string;
      dragDrop: string;
      change: string;
      remove: string;
    };
    durationLabel: string;
    durationOptionLabel: (seconds: number) => string;
    generateButton: (credits: number) => string;
    generating: string;
    loadingStatus: {
      title: string;
      steps: {
        preparing: string;
        sending: string;
        rendering: string;
        finalizing: string;
      };
    };
    emptyState: {
      title: string;
      subtitle: string;
    };
    results: {
      download: string;
      reuseSettings: string;
      generateAgain: string;
    };
    toolbar: {
      history: string;
      new: string;
    };
    insufficientCredits: string;
  };
  videoEditor: {
    addVideo: string;
    addImage: string;
    addMusic: string;
    addFromProjects: string;
    toolbar: { new: string };
    emptyState: {
      title: string;
      subtitle: string;
      addVideo: string;
      addImage: string;
    };
    timeline: {
      videoTrackLabel: string;
      audioTrackLabel: string;
      emptyHint: string;
      addTransition: string;
      editTransition: string;
    };
    panel: {
      project: {
        title: string;
        formatLabel: string;
        formatOptions: { auto: string; reels: string; feed: string; youtube: string; square: string };
        fitLabel: string;
        fitOptions: { contain: string; cover: string };
        resolutionLabel: string;
        resolutionOptions: { auto: string; r720: string; r1080: string };
        clipCount: (n: number) => string;
        totalDuration: string;
        selectHint: string;
      };
      videoClip: {
        title: string;
        durationLabel: string;
        speedLabel: string;
        volumeLabel: string;
        split: string;
        duplicate: string;
        delete: string;
      };
      image: {
        title: string;
        durationLabel: string;
        duplicate: string;
        delete: string;
      };
      motion: {
        label: string;
        intensityLabel: string;
        options: {
          none: string;
          zoomIn: string;
          zoomOut: string;
          panLeft: string;
          panRight: string;
          panUp: string;
          panDown: string;
          kenBurns: string;
        };
        intensityOptions: { soft: string; medium: string };
        timing: {
          label: string;
          fullClip: string;
          start: string;
          duration: string;
        };
      };
      audio: {
        title: string;
        volumeLabel: string;
        fadeIn: string;
        fadeOut: string;
        fadeDurationLabel: string;
        trimStartLabel: string;
        trimEndLabel: string;
        remove: string;
      };
      transition: {
        title: string;
        typeLabel: string;
        durationLabel: string;
        options: { none: string; fade: string; dissolve: string; slide: string; zoom: string };
      };
    };
    export: {
      button: string;
      preparing: string;
      exporting: (percent: number) => string;
      ready: string;
      download: string;
      continueEditing: string;
      failed: string;
    };
    myProjectsModal: {
      title: string;
      empty: string;
      add: string;
      close: string;
    };
    editFromVideoIa: string;
    errors: {
      uploadFailed: string;
      noClips: string;
    };
  };
  financial: {
    newTransaction: string;
    exportCsv: string;
    periods: {
      today: string;
      yesterday: string;
      last7: string;
      thisMonth: string;
      last30: string;
      custom: string;
      from: string;
      to: string;
      apply: string;
    };
    typeFilter: { all: string; income: string; expense: string };
    searchPlaceholder: string;
    cards: {
      balance: string;
      income: string;
      expense: string;
      receivable: string;
      payable: string;
      forecast: string;
      receivableNext30: string;
      payableNext30: string;
      overdueHint: (amount: string) => string;
    };
    resultSummary: {
      title: string;
      income: string;
      expense: string;
      result: string;
      margin: string;
    };
    chart: {
      title: string;
      incomeLabel: string;
      expenseLabel: string;
      flowMode: string;
      balanceMode: string;
      realizedMode: string;
      forecastMode: string;
      empty: string;
    };
    categoryChart: {
      title: string;
      empty: string;
    };
    upcoming: {
      title: string;
      empty: string;
      dueToday: string;
      dueTomorrow: string;
      dueOverdue: string;
      dueInDays: (days: number) => string;
      receivableLabel: string;
      payableLabel: string;
      markReceived: string;
      markPaid: string;
    };
    table: {
      title: string;
      columns: {
        date: string;
        description: string;
        client: string;
        project: string;
        category: string;
        type: string;
        value: string;
        status: string;
      };
      empty: string;
      addFirst: string;
      actions: {
        markReceived: string;
        markPaid: string;
        edit: string;
        duplicate: string;
        delete: string;
      };
    };
    csv: {
      dueDate: string;
      paymentMethod: string;
    };
    filters: {
      button: string;
      title: string;
      client: string;
      project: string;
      category: string;
      status: string;
      allStatuses: string;
      paymentMethod: string;
      allPaymentMethods: string;
      valueMin: string;
      valueMax: string;
      apply: string;
      clear: string;
      anyClient: string;
      anyProject: string;
      anyCategory: string;
    };
    status: {
      received: string;
      receivable: string;
      paid: string;
      payable: string;
      overdue: string;
    };
    form: {
      titleNew: string;
      titleEdit: string;
      typeIncome: string;
      typeExpense: string;
      description: string;
      amount: string;
      category: string;
      newCategory: string;
      newCategoryPlaceholder: string;
      createCategoryAction: string;
      transactionDate: string;
      dueDate: string;
      settledYesIncome: string;
      settledYesExpense: string;
      settledNo: string;
      projectOptional: string;
      clientOptional: string;
      newClient: string;
      addClient: string;
      paymentMethod: string;
      paymentNote: string;
      notes: string;
      repeat: string;
      repeatUntilOptional: string;
      installmentToggle: string;
      installmentCount: string;
      installmentFirstDue: string;
      installmentPreview: (count: number, amount: string) => string;
      attachment: string;
      attachmentHint: string;
      attachmentUploading: string;
      attachmentError: string;
      attachmentInvalidFormat: string;
      attachmentTooLarge: string;
      cancel: string;
      save: string;
    };
    paymentMethods: {
      pix: string;
      bankTransfer: string;
      creditCard: string;
      debitCard: string;
      boleto: string;
      cash: string;
      other: string;
    };
    deleteConfirm: {
      title: string;
      message: (description: string, amount: string) => string;
      confirm: string;
      cancel: string;
      installmentPrompt: string;
      installmentThisOnly: string;
      installmentAllFuture: string;
    };
    emptyState: {
      title: string;
      addFirst: string;
    };
    errors: {
      categoryInUse: string;
      generic: string;
    };
    clientsButton: string;
    clientsModal: {
      title: string;
      searchPlaceholder: string;
      addButton: string;
      empty: string;
      noResults: string;
      nameLabel: string;
      companyLabel: string;
      emailLabel: string;
      phoneLabel: string;
      addressLabel: string;
      notesLabel: string;
      save: string;
      cancel: string;
      edit: string;
      delete: string;
      deleteConfirm: (name: string) => string;
      newTitle: string;
      editTitle: string;
      nameRequired: string;
      saveError: string;
      deleteError: string;
    };
  };
  projectFlow: {
    title: string;
    subtitle: string;
    newProject: string;
    summary: {
      active: string;
      overdue: string;
      dueThisWeek: string;
      receivable: string;
    };
    statusFilters: {
      all: string;
      onTrack: string;
      dueSoon: string;
      overdue: string;
      waitingForClient: string;
      completed: string;
    };
    filters: {
      label: string;
      priority: string;
      showArchived: string;
    };
    searchPlaceholder: string;
    view: { board: string; list: string };
    dueStatus: {
      onTrack: string;
      dueSoon: string;
      dueToday: string;
      overdue: string;
      completed: string;
    };
    priority: {
      options: { low: string; normal: string; high: string; urgent: string };
    };
    waitingForClient: { label: string; badge: string };
    approval: {
      options: { none: string; awaitingApproval: string; changesRequested: string; approved: string };
    };
    card: {
      received: string;
      receivable: string;
      due: string;
      daysInStage: (days: number) => string;
    };
    stages: {
      rename: string;
      delete: string;
      empty: string;
      add: string;
      namePlaceholder: string;
      deleteConfirmTitle: (name: string) => string;
      deleteMigratePrompt: (count: number) => string;
      moveProjectsTo: string;
    };
    detail: {
      detailsTab: string;
      noClient: string;
      noType: string;
      noStage: string;
      stage: string;
      approval: string;
      contractValue: string;
      startDate: string;
      dueDate: string;
      nextAction: string;
      checklist: string;
      addTask: string;
      notes: string;
      history: string;
      edit: string;
      duplicate: string;
      archive: string;
      unarchive: string;
      reopen: string;
      markCompleted: string;
    };
    form: {
      titleNew: string;
      titleEdit: string;
      name: string;
      clientOptional: string;
      projectType: string;
      contractValue: string;
      initialStage: string;
      startDate: string;
      dueDate: string;
      priority: string;
      responsibleOptional: string;
      newClient: string;
      addClient: string;
      tags: string;
      addTag: string;
      nextActionOptional: string;
      notes: string;
      cancel: string;
      save: string;
    };
    list: {
      sortBy: string;
      sortOptions: { dueDate: string; priority: string; name: string };
      columns: {
        name: string;
        stage: string;
        client: string;
        due: string;
        value: string;
        received: string;
        receivable: string;
        status: string;
      };
    };
    emptyState: {
      title: string;
      subtitle: string;
      cta: string;
    };
  };
  projectFiles: {
    tabLabel: string;
    title: string;
    subtitle: string;
    addButton: string;
    searchPlaceholder: string;
    sortLabel: string;
    sortOptions: { newest: string; oldest: string; name: string };
    categoryFilterAll: string;
    categories: Record<ProjectFileCategory, string>;
    columns: { name: string; category: string; date: string; uploadedBy: string; size: string; actions: string };
    uploadedByYou: string;
    actions: { view: string; download: string; edit: string; delete: string };
    empty: { title: string; description: string; cta: string };
    noResults: string;
    upload: {
      modalTitle: string;
      nameLabel: string;
      categoryLabel: string;
      descriptionLabel: string;
      descriptionPlaceholder: string;
      fileLabel: string;
      dragDropText: string;
      selectFileButton: string;
      formatsHint: string;
      submit: string;
      submitting: string;
      successMessage: string;
      errorGeneric: string;
      invalidFormat: string;
      tooLarge: string;
    };
    edit: {
      modalTitle: string;
      nameLabel: string;
      categoryLabel: string;
      descriptionLabel: string;
      submit: string;
      submitting: string;
      errorGeneric: string;
    };
    deleteConfirm: {
      title: string;
      body: string;
      confirm: string;
      cancel: string;
      deleting: string;
      errorGeneric: string;
    };
    previewUnavailable: string;
  };
  projectFinancialTab: {
    tabLabel: string;
    contractValue: string;
    received: string;
    receivable: string;
    expenses: string;
    resultRealized: string;
    resultForecast: string;
    margin: string;
    installmentsTitle: string;
    expensesTitle: string;
    recentTitle: string;
    addButton: string;
    empty: string;
  };
  sales: {
    meta: {
      title: string;
      description: string;
    };
    header: {
      navFeatures: string;
      navResults: string;
      navHowItWorks: string;
      navPricing: string;
      navFaq: string;
      login: string;
      ctaStart: string;
    };
    hero: {
      eyebrow: string;
      headline: string;
      subheadline: string;
      ctaPrimary: string;
      ctaSecondary: string;
      trustLine: string;
      beforeLabel: string;
      afterLabel: string;
    };
    compatibility: {
      title: string;
      body: string;
      note: string;
    };
    demo: {
      title: string;
      subtitle: string;
      categories: { interior: string; exterior: string; commercial: string; landscape: string };
      beforeLabel: string;
      afterLabel: string;
    };
    workflow: {
      title: string;
      subtitle: string;
      steps: [
        { title: string; body: string },
        { title: string; body: string },
        { title: string; body: string },
        { title: string; body: string },
      ];
    };
    showcase: {
      title: string;
      subtitle: string;
      body: string;
      controls: {
        projectType: string;
        preserveArchitecture: string;
        style: string;
        lighting: string;
        environment: string;
        aspectRatio: string;
        instructions: string;
        reference: string;
        engine: string;
      };
    };
    preservation: {
      title: string;
      body: string;
      disclaimer: string;
      beforeLabel: string;
      afterLabel: string;
      points: { geometry: string; perspective: string; volumetry: string; composition: string };
    };
    features: {
      title: string;
      subtitle: string;
      render: { title: string; body: string; cta: string };
      ideas: { title: string; body: string; cta: string };
      textToImage: { title: string; body: string; cta: string };
      reference: { title: string; body: string; cta: string };
      video: { title: string; body: string; cta: string };
      plantaHumanizada: { title: string; body: string; cta: string };
      comingSoonTitle: string;
      comingSoonBody: string;
    };
    models: {
      title: string;
      subtitle: string;
      fastTitle: string;
      fastBody: string;
      proTitle: string;
      proBody: string;
      ultraTitle: string;
      ultraBody: string;
      comingSoonBadge: string;
    };
    cloud: {
      title: string;
      subtitle: string;
      traditionalLabel: string;
      blueRenderLabel: string;
    };
    comparison: {
      title: string;
      traditionalTitle: string;
      traditionalSteps: [string, string, string, string, string, string];
      blueRenderTitle: string;
      blueRenderSteps: [string, string, string, string];
    };
    gallery: {
      title: string;
      subtitle: string;
      filters: { all: string; interior: string; exterior: string; residential: string; commercial: string; landscape: string };
      openLabel: string;
      closeLabel: string;
    };
    audience: {
      title: string;
      items: {
        architects: { title: string; body: string };
        designers: { title: string; body: string };
        engineers: { title: string; body: string };
        students: { title: string; body: string };
        artists3d: { title: string; body: string };
        offices: { title: string; body: string };
      };
    };
    results: {
      title: string;
      body: string;
    };
    recommender: {
      title: string;
      subtitle: string;
      q1: string;
      q1Options: [string, string, string];
      q2: string;
      q2Options: [string, string];
      resultPrefix: string;
      restart: string;
    };
    pricing: {
      title: string;
      subtitle: string;
      usageNote: string;
      usageModalTitle: string;
      usageModalClose: string;
      usageTableToolLabel: string;
      usageTableVideoLabel: string;
    };
    faq: {
      title: string;
      subtitle: string;
      items: { q: string; a: string }[];
    };
    finalCta: {
      headline: string;
      subheadline: string;
      cta: string;
      trustLine: string;
    };
    footer: {
      tagline: string;
      productTitle: string;
      resourcesTitle: string;
      companyTitle: string;
      tools: string;
      pricingLink: string;
      galleryLink: string;
      faqLink: string;
      support: string;
      contact: string;
      instagram: string;
      whatsapp: string;
      copyright: (year: number) => string;
    };
  };
  architectChat: {
    title: string;
    newConversation: string;
    untitledConversation: string;
    conversationsTitle: string;
    noConversations: string;
    deleteConversation: string;
    deleteConfirmMessage: string;
    emptyStateTitle: string;
    emptyStateSubtitle: string;
    emptyStateSuggestions: string[];
    composerPlaceholder: string;
    send: string;
    attach: string;
    attachImage: string;
    attachAudio: string;
    removeAttachment: string;
    recordStart: string;
    recordStop: string;
    recording: string;
    micUnavailable: string;
    thinking: string;
    you: string;
    assistantName: string;
    transcriptLabel: string;
    retry: string;
    copy: string;
    copied: string;
    costNotice: (credits: number) => string;
    unavailableTitle: string;
    unavailableMessage: string;
    attachTooMany: (max: number) => string;
    fileTooLarge: string;
    failureNoCharge: string;
  };
}
