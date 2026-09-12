const translations = {
  tr: {
    arcMaster: 'ARC MASTER',
    settings: 'Ayarlar',
    markCompleted: 'Bu bölümü izlendi olarak işaretle',
    markArcCompleted: "Bu arc'taki tüm bölümleri izlendi olarak işaretle",
    markThroughCurrent: 'Bu bölüme kadar tümünü izlendi olarak işaretle'
  },
  en: {
    arcMaster: 'ARC MASTER',
    settings: 'Settings',
    markCompleted: 'Mark this episode as watched',
    markArcCompleted: 'Mark every episode in this arc as watched',
    markThroughCurrent: 'Mark everything through this episode as watched'
  },
  es: {
    arcMaster: 'MAESTRO DE ARCOS',
    settings: 'Ajustes',
    markCompleted: 'Marcar este episodio como visto',
    markArcCompleted: 'Marcar todos los episodios de este arco como vistos',
    markThroughCurrent: 'Marcar como visto todo hasta este episodio'
  }
};

export function translate(language, key) {
  return translations[language]?.[key] ?? translations.tr[key] ?? key;
}
