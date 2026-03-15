Erstelle ein PRD für ein IoT-basiertes Gewächshaus-Steuerungssystem.

Features:
- Sensorüberwachung (Temperatur, Luftfeuchtigkeit, Bodenfeuchtigkeit, Licht, CO2)
- Automatische Steuerung von Bewässerung, Belüftung, Heizung und Beleuchtung
- Regelbasierte Automatisierung mit benutzerdefinierten Schwellenwerten
- Alarmierung bei kritischen Abweichungen (SMS, E-Mail, Push)
- Historische Datenanalyse mit Trendvisualisierung
- Pflanzenprofil-Datenbank mit optimalen Wachstumsparametern
- Multi-Gewächshaus-Management über ein zentrales Dashboard
- Offline-Fähigkeit: lokale Steuerung bei Netzwerkausfall

Besondere Anforderungen:
- Echtzeit-Datenverarbeitung mit max. 500ms Latenz
- Unterstützung von mind. 200 Sensoren pro Gewächshaus
- Batterieoptimierte Sensorkommunikation (LoRaWAN/Zigbee)
- Ausfallsicherheit: redundante Steuerungslogik
- Saisonale Zeitpläne mit astronomischer Uhr
- API für Drittanbieter-Integrationen (Wetterdienst, Energieversorger)

Zielgruppe: Professionelle Gartenbaubetriebe und Forschungseinrichtungen.
Technologie: Embedded C für Mikrocontroller, Python/FastAPI Backend, Vue.js Frontend, InfluxDB für Zeitreihendaten, MQTT für Sensorkommunikation.
