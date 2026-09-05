const translations = {
  tr: {
    arcMaster: 'ARC MASTER',
    settings: 'Ayarlar',
    markCompleted: 'Bölümü tamamlandı yap'
  },
  en: {
    arcMaster: 'ARC MASTER',
    settings: 'Settings',
    markCompleted: 'Mark episode complete'
  },
  es: {
    arcMaster: 'MAESTRO DE ARCOS',
    settings: 'Ajustes',
    markCompleted: 'Marcar episodio como completado'
  }
};

export function translate(language, key) {
  return translations[language]?.[key] ?? translations.tr[key] ?? key;
}
