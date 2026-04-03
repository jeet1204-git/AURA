export const A2_EXAM_TOPICS = [
  // ── TEIL 1 ──────────────────────────────────────────────────────────────────
  { topicId:'teil1_set_standard', part:'teil1', level:'A2', title:'Fragen zur Person', theme:'person', cards:['Geburtstag', 'Wohnort', 'Beruf', 'Hobby'], promptText:'Fragen zur Person', cueSetId:null, cueDimensions:[], estimatedDifficulty:'core', expectedAnswerLength:'medium', source:'goethe_official_model_v1', sourceDatasetVersion:'a2_exam_dataset_v2', active:true },
  { topicId:'teil1_set_alltag', part:'teil1', level:'A2', title:'Fragen zur Person', theme:'person', cards:['Familie', 'Wohnung', 'Sprachen', 'Sport'], promptText:'Fragen zur Person', cueSetId:null, cueDimensions:[], estimatedDifficulty:'core', expectedAnswerLength:'medium', source:'goethe_official_model_v1', sourceDatasetVersion:'a2_exam_dataset_v2', active:true },
  { topicId:'teil1_set_freizeit', part:'teil1', level:'A2', title:'Fragen zur Person', theme:'person', cards:['Hobby', 'Lieblingsessen', 'Urlaub', 'Musik'], promptText:'Fragen zur Person', cueSetId:null, cueDimensions:[], estimatedDifficulty:'core', expectedAnswerLength:'medium', source:'goethe_official_model_v1', sourceDatasetVersion:'a2_exam_dataset_v2', active:true },
  { topicId:'teil1_set_beruf', part:'teil1', level:'A2', title:'Fragen zur Person', theme:'person', cards:['Beruf', 'Arbeitsweg', 'Kollegen', 'Feierabend'], promptText:'Fragen zur Person', cueSetId:null, cueDimensions:[], estimatedDifficulty:'core', expectedAnswerLength:'medium', source:'goethe_official_model_v1', sourceDatasetVersion:'a2_exam_dataset_v2', active:true },
  { topicId:'teil1_set_wohnen', part:'teil1', level:'A2', title:'Fragen zur Person', theme:'person', cards:['Wohnort', 'Wohnung', 'Nachbarn', 'Lieblingsort'], promptText:'Fragen zur Person', cueSetId:null, cueDimensions:[], estimatedDifficulty:'core', expectedAnswerLength:'medium', source:'goethe_official_model_v1', sourceDatasetVersion:'a2_exam_dataset_v2', active:true },
  // ── TEIL 2 — all 31 topics from backend manual v2 ────────────────────────
  {
    topicId:'t2_wochenende', part:'teil2', level:'A2',
    title:'Was machen Sie am Wochenende?', theme:'freizeit',
    promptText:'Was machen Sie am Wochenende?',
    corners:['Jemanden besuchen','Sport','Wo','Mit wem'],
    modelSentences:['Am Wochenende habe ich endlich Zeit für mich und meine Familie.','Meistens besuche ich am Samstag meine Freunde, weil wir uns unter der Woche selten sehen.','Wenn das Wetter schön ist, treffen wir uns im Park oder in der Stadt.','Dort gehen wir oft spazieren oder trinken zusammen einen Kaffee.','Außerdem treibe ich gern Sport, besonders Cricket oder Fußball.','Manchmal spiele ich mit meinen Freunden im Sportverein, weil Bewegung mir guttut.','Am Sonntag unternehme ich oft etwas mit meiner Familie.','Wir fahren manchmal in eine andere Stadt oder essen zusammen im Restaurant.','Wenn ich zu Hause bleibe, höre ich Musik oder sehe einen Film.','So kann ich mich gut erholen und neue Energie für die Woche sammeln.','Besonders wichtig ist mir, dass ich am Wochenende nicht nur lerne, sondern auch Spaß habe.','Deshalb plane ich meine Freizeit ziemlich bewusst und nutze sie sinnvoll.'],
    cueSetId:'cue_teil2_daily_v1', cueDimensions:['visit','sport','place','people'], estimatedDifficulty:'core', expectedAnswerLength:'long', source:'manual_v2', sourceDatasetVersion:'a2_exam_dataset_v2', active:true
  },
  {
    topicId:'t2_geld_ausgeben', part:'teil2', level:'A2',
    title:'Wofür geben Sie Ihr Geld aus?', theme:'geld',
    promptText:'Wofür geben Sie Ihr Geld aus?',
    corners:['Miete','Urlaub','Essen','Einkaufen'],
    modelSentences:['Ich gebe mein Geld vor allem für wichtige Dinge aus.','Zuerst bezahle ich jeden Monat die Miete, denn ohne Wohnung geht es natürlich nicht.','Zum Glück ist meine Wohnung nicht sehr teuer, deshalb kann ich etwas sparen.','Außerdem brauche ich Geld für Essen und Getränke im Alltag.','Ich koche oft zu Hause, weil das billiger und gesünder ist.','Trotzdem gehe ich am Wochenende manchmal mit Freunden ins Restaurant.','Ein Teil meines Geldes ist auch für Urlaub reserviert.','Ich reise nicht luxuriös, sondern meistens mit dem Zug, weil das günstiger ist.','Manchmal kaufe ich Kleidung oder kleine Dinge für den Haushalt.','Am liebsten kaufe ich online ein, weil man Preise gut vergleichen kann.','Ich versuche aber, nicht zu viel Geld für unnötige Sachen auszugeben.','So habe ich am Monatsende noch genug Geld für wichtige Pläne.'],
    cueSetId:'cue_teil2_daily_v1', cueDimensions:['rent','holiday','food','shopping'], estimatedDifficulty:'core', expectedAnswerLength:'long', source:'manual_v2', sourceDatasetVersion:'a2_exam_dataset_v2', active:true
  },
  {
    topicId:'t2_geld_machen', part:'teil2', level:'A2',
    title:'Was machen Sie mit Ihrem Geld?', theme:'geld',
    promptText:'Was machen Sie mit Ihrem Geld?',
    corners:['Lebensmittel, Miete','Spare','Reise','Kleidung'],
    modelSentences:['Mit meinem Geld decke ich zuerst meine festen Kosten.','Dazu gehören vor allem die Miete und meine Lebensmittel.','Da ich jeden Tag etwas essen muss, plane ich diese Ausgaben ziemlich genau.','Ich finde es wichtig, jeden Monat auch etwas Geld zu sparen.','Obwohl das nicht immer leicht ist, lege ich wenigstens einen kleinen Betrag zurück.','Wenn ich genug gespart habe, reise ich sehr gern in den Urlaub.','Dann fahre ich meistens mit dem Zug, weil das günstiger als ein Flug ist.','Außerdem kaufe ich ab und zu Kleidung, wenn ich wirklich etwas brauche.','Besonders oft suche ich im Internet nach Angeboten.','Dort ist vieles billiger, und ich muss nicht lange in Geschäften warten.','Trotzdem versuche ich, mein Geld nicht sofort auszugeben.','Ich möchte vernünftig mit Geld umgehen, damit ich später weniger Stress habe.'],
    cueSetId:'cue_teil2_daily_v1', cueDimensions:['food_rent','savings','travel','clothing'], estimatedDifficulty:'core', expectedAnswerLength:'long', source:'manual_v2', sourceDatasetVersion:'a2_exam_dataset_v2', active:true
  },
  {
    topicId:'t2_verkehrsmittel', part:'teil2', level:'A2',
    title:'Welche Verkehrsmittel benutzen Sie?', theme:'transport',
    promptText:'Welche Verkehrsmittel benutzen Sie?',
    corners:['Arbeitsweg','Freizeit','Urlaub','oft/selten'],
    modelSentences:['Ich benutze im Alltag verschiedene Verkehrsmittel.','Für meinen Arbeitsweg nehme ich meistens den Bus oder die Bahn.','Wenn das Wetter gut ist, fahre ich auch mit dem Fahrrad, weil das gesund ist.','In meiner Freizeit gehe ich kurze Wege lieber zu Fuß.','So kann ich mich bewegen und gleichzeitig Geld sparen.','Mit Freunden fahre ich manchmal mit der Straßenbahn in die Stadt.','Im Urlaub benutze ich am liebsten den Zug, weil er bequem und umweltfreundlich ist.','Nur selten fliege ich mit dem Flugzeug, denn das ist teuer und nicht gut für die Umwelt.','Ein Auto brauche ich nicht jeden Tag.','Trotzdem ist es praktisch, wenn man schnell irgendwohin fahren muss.','Am häufigsten benutze ich also öffentliche Verkehrsmittel und das Fahrrad.','Diese Kombination passt am besten zu meinem Alltag.'],
    cueSetId:'cue_teil2_daily_v1', cueDimensions:['commute','leisure','holiday','frequency'], estimatedDifficulty:'core', expectedAnswerLength:'long', source:'manual_v2', sourceDatasetVersion:'a2_exam_dataset_v2', active:true
  },
  {
    topicId:'t2_kleidung', part:'teil2', level:'A2',
    title:'Welche Kleidung tragen Sie gern?', theme:'kleidung',
    promptText:'Welche Kleidung tragen Sie gern?',
    corners:['In der Freizeit','Gern','Bei der Arbeit','Nicht gern'],
    modelSentences:['In meiner Freizeit trage ich am liebsten bequeme Kleidung.','Meistens ziehe ich Jeans, ein T-Shirt und Sportschuhe an.','Wenn es kalt ist, trage ich zusätzlich einen Pullover oder eine Jacke.','Mir ist wichtig, dass die Kleidung nicht nur schön aussieht, sondern auch praktisch ist.','Bei der Arbeit muss ich allerdings etwas formeller angezogen sein.','Dann trage ich oft ein Hemd, eine Hose und manchmal auch eine Jacke.','Für besondere Anlässe ziehe ich gern modische Kleidung an.','Zum Beispiel trage ich beim Ausgehen oder im Konzert etwas Schickeres.','Nicht gern trage ich sehr enge oder unbequeme Sachen.','Außerdem mag ich Kleidung nicht, in der ich mich kaum bewegen kann.','Meiner Meinung nach sollte Kleidung zur Situation passen.','Deshalb wähle ich je nach Ort und Anlass unterschiedliche Sachen aus.'],
    cueSetId:'cue_teil2_daily_v1', cueDimensions:['leisure','preferred','work','disliked'], estimatedDifficulty:'core', expectedAnswerLength:'long', source:'manual_v2', sourceDatasetVersion:'a2_exam_dataset_v2', active:true
  },
  {
    topicId:'t2_internet', part:'teil2', level:'A2',
    title:'Was bedeutet das Internet für Sie?', theme:'internet',
    promptText:'Was bedeutet das Internet für Sie?',
    corners:['Wichtig','Wie lange täglich','Einkaufen','Lernen'],
    modelSentences:['Das Internet ist für mich im Alltag sehr wichtig.','Ich benutze es jeden Tag, sowohl für die Arbeit als auch für private Dinge.','Im Durchschnitt bin ich mehrere Stunden täglich online.','Besonders praktisch finde ich, dass man schnell Informationen finden kann.','Außerdem kaufe ich manchmal im Internet ein, wenn ich keine Zeit für Geschäfte habe.','Online kann man Preise vergleichen, deshalb spart man oft Geld.','Für das Lernen ist das Internet ebenfalls sehr nützlich.','Ich sehe mir Videos an, suche Erklärungen und mache Übungen online.','Manchmal habe ich sogar Online-Unterricht oder spreche mit Freunden über Video.','Trotzdem finde ich, dass man das Internet nicht zu lange benutzen sollte.','Sonst verbringt man zu viel Zeit am Bildschirm und wird schnell müde.','Insgesamt ist das Internet für mich hilfreich, wenn ich es bewusst nutze.'],
    cueSetId:'cue_teil2_daily_v1', cueDimensions:['importance','duration','shopping','learning'], estimatedDifficulty:'core', expectedAnswerLength:'long', source:'manual_v2', sourceDatasetVersion:'a2_exam_dataset_v2', active:true
  },
  {
    topicId:'t2_einkaufen_wo', part:'teil2', level:'A2',
    title:'Wo kaufen Sie am liebsten ein?', theme:'einkaufen',
    promptText:'Wo kaufen Sie am liebsten ein?',
    corners:['Im Internet','In Geschäften','Auf Flohmärkten','Andere Orte'],
    modelSentences:['Am liebsten kaufe ich dort ein, wo es praktisch und nicht zu teuer ist.','Für Kleidung oder Technik nutze ich oft das Internet.','Dort finde ich viele Angebote, und ich kann alles in Ruhe vergleichen.','Trotzdem kaufe ich manche Dinge lieber direkt im Geschäft.','Das ist besonders wichtig, wenn ich etwas anprobieren oder sofort mitnehmen möchte.','Lebensmittel kaufe ich meistens im Supermarkt oder auf dem Markt.','Auf dem Markt finde ich Obst und Gemüse oft frischer als im Laden.','Flohmärkte besuche ich manchmal auch sehr gern.','Dort kann man interessante und günstige Sachen finden.','Allerdings kaufe ich dort nicht alles, weil man die Ware gut prüfen muss.','Im Allgemeinen entscheide ich nach Produkt, Preis und Zeit.','Deshalb kaufe ich je nach Situation an verschiedenen Orten ein.'],
    cueSetId:'cue_teil2_daily_v1', cueDimensions:['online','instore','flea_market','other'], estimatedDifficulty:'core', expectedAnswerLength:'long', source:'manual_v2', sourceDatasetVersion:'a2_exam_dataset_v2', active:true
  },
  {
    topicId:'t2_einkaufen_wie', part:'teil2', level:'A2',
    title:'Wie kaufen Sie ein?', theme:'einkaufen',
    promptText:'Wie kaufen Sie ein?',
    corners:['Bezahlung','Kaufhaus','Online/Einkaufszentrum','Wo/Wie oft/Mit wem'],
    modelSentences:['Beim Einkaufen achte ich vor allem auf Preis, Qualität und Bezahlung.','Meistens bezahle ich mit Karte, weil das schnell und bequem ist.','Wenn ich in kleinen Geschäften bin, nehme ich manchmal auch Bargeld mit.','Ins Kaufhaus gehe ich nicht sehr oft, aber manchmal finde ich dort viele Dinge an einem Ort.','Noch praktischer ist für mich das Einkaufen im Internet.','Dort kann ich auch spät abends bestellen, wenn die Geschäfte schon geschlossen sind.','In ein Einkaufszentrum gehe ich manchmal mit Freunden oder mit meiner Familie.','Dann kaufen wir nicht nur ein, sondern trinken auch zusammen einen Kaffee.','Für Lebensmittel gehe ich meistens allein in den Supermarkt.','Das mache ich mehrmals pro Woche, weil ich frische Sachen mag.','Online kaufe ich eher Kleidung oder technische Produkte.','So kaufe ich je nach Produkt und Situation unterschiedlich ein.'],
    cueSetId:'cue_teil2_daily_v1', cueDimensions:['payment','department_store','online','frequency'], estimatedDifficulty:'core', expectedAnswerLength:'long', source:'manual_v2', sourceDatasetVersion:'a2_exam_dataset_v2', active:true
  },
  {
    topicId:'t2_familie', part:'teil2', level:'A2',
    title:'Was machen Sie mit Ihrer Familie?', theme:'familie',
    promptText:'Was machen Sie mit Ihrer Familie?',
    corners:['Fernsehen','Essen','Feste','Spazierengehen'],
    modelSentences:['Mit meiner Familie verbringe ich gern Zeit, besonders am Wochenende.','Abends essen wir oft zusammen, weil wir dann alle zu Hause sind.','Beim Essen sprechen wir über unseren Tag und planen die nächsten Tage.','Manchmal kochen wir auch gemeinsam, obwohl das nicht jeden Tag möglich ist.','Nach dem Essen sehen wir manchmal zusammen fern.','Am liebsten schauen wir Filme oder lustige Sendungen.','Feste feiern wir natürlich auch gemeinsam.','Zu Weihnachten oder zu Geburtstagen kommt oft die ganze Familie zusammen.','Dann essen wir viel, reden lange und haben eine schöne Atmosphäre.','Wenn das Wetter gut ist, gehen wir außerdem gern spazieren.','Manchmal gehen wir in den Park oder laufen einfach durch die Stadt.','Diese gemeinsamen Momente sind für mich sehr wichtig, weil sie die Familie stärken.'],
    cueSetId:'cue_teil2_daily_v1', cueDimensions:['tv','food','celebrations','walks'], estimatedDifficulty:'core', expectedAnswerLength:'long', source:'manual_v2', sourceDatasetVersion:'a2_exam_dataset_v2', active:true
  },
  {
    topicId:'t2_ausgehen_abend', part:'teil2', level:'A2',
    title:'Was machen Sie, wenn Sie am Abend ausgehen?', theme:'freizeit',
    promptText:'Was machen Sie, wenn Sie am Abend ausgehen?',
    corners:['Club/Disko','Essen','Konzert','Theater'],
    modelSentences:['Wenn ich am Abend ausgehe, möchte ich mich entspannen und etwas Schönes erleben.','Oft treffe ich mich zuerst mit Freunden oder mit meiner Freundin.','Manchmal gehen wir zusammen ins Restaurant und essen dort zu Abend.','Wenn wir Lust auf Musik haben, gehen wir in einen Club oder in eine Disko.','Dort tanzen wir viel und haben meistens gute Laune.','Ab und zu besuche ich auch gern ein Konzert.','Live-Musik gefällt mir besonders, weil die Stimmung dort ganz anders ist.','Ins Theater gehe ich seltener, aber manchmal finde ich das auch interessant.','Dann möchte ich lieber etwas Ruhigeres machen.','Je nachdem, wie müde ich bin, entscheide ich spontan.','Wenn ich am nächsten Tag arbeiten muss, bleibe ich nicht sehr lange draußen.','Trotzdem finde ich es wichtig, ab und zu auszugehen und das Leben zu genießen.'],
    cueSetId:'cue_teil2_daily_v1', cueDimensions:['club','dining','concert','theatre'], estimatedDifficulty:'core', expectedAnswerLength:'long', source:'manual_v2', sourceDatasetVersion:'a2_exam_dataset_v2', active:true
  },
  {
    topicId:'t2_freizeit', part:'teil2', level:'A2',
    title:'Was machen Sie gern in Ihrer Freizeit?', theme:'freizeit',
    promptText:'Was machen Sie gern in Ihrer Freizeit?',
    corners:['Freunde besuchen','Lesen','Rad fahren','Andere Aktivitäten'],
    modelSentences:['In meiner Freizeit mache ich gern verschiedene Dinge.','Besonders gern treffe ich meine Freunde, wenn wir alle Zeit haben.','Dann gehen wir ins Kino, ins Café oder einfach spazieren.','Außerdem fahre ich gern Fahrrad, weil ich dabei aktiv bin und frische Luft bekomme.','Am Wochenende mache ich manchmal einen kleinen Ausflug mit dem Rad.','Lesen mag ich auch, obwohl ich nicht jeden Tag genug Zeit dafür habe.','Wenn ich Ruhe brauche, lese ich zu Hause ein Buch oder einen Artikel im Internet.','Manchmal höre ich Musik oder sehe einen Film.','Ich treibe auch gern Sport, weil das gut für die Gesundheit ist.','Wenn das Wetter schön ist, verbringe ich möglichst viel Zeit draußen.','So kann ich mich erholen und gleichzeitig etwas Interessantes machen.','Freizeit ist für mich wichtig, weil ich dann neue Energie bekomme.'],
    cueSetId:'cue_teil2_daily_v1', cueDimensions:['friends','reading','cycling','other'], estimatedDifficulty:'core', expectedAnswerLength:'long', source:'manual_v2', sourceDatasetVersion:'a2_exam_dataset_v2', active:true
  },
  {
    topicId:'t2_freitagabend', part:'teil2', level:'A2',
    title:'Was machen Sie oft am Freitagabend?', theme:'freizeit',
    promptText:'Was machen Sie oft am Freitagabend?',
    corners:['Ins Kino gehen','Freunde treffen','Früh ins Bett gehen','Andere Aktivitäten'],
    modelSentences:['Der Freitagabend ist für mich etwas Besonderes, weil dann das Wochenende beginnt.','Nach einer anstrengenden Woche möchte ich mich zuerst entspannen.','Oft treffe ich mich am Freitagabend mit Freunden.','Dann gehen wir manchmal ins Kino oder essen zusammen etwas.','Wenn ein guter Film läuft, verbringen wir den Abend gern dort.','Manchmal bleibe ich aber auch zu Hause und höre Musik oder sehe fern.','Wenn ich sehr müde bin, gehe ich sogar früh ins Bett.','Das passiert besonders dann, wenn die Woche stressig war.','Ab und zu koche ich am Freitagabend auch für meine Familie.','Dann essen wir zusammen und sprechen über die Woche.','Ich finde es schön, dass der Freitagabend so viele Möglichkeiten bietet.','Je nach Stimmung entscheide ich, ob ich aktiv bin oder mich lieber ausruhe.'],
    cueSetId:'cue_teil2_daily_v1', cueDimensions:['cinema','friends','earlybed','other'], estimatedDifficulty:'core', expectedAnswerLength:'long', source:'manual_v2', sourceDatasetVersion:'a2_exam_dataset_v2', active:true
  },
  {
    topicId:'t2_urlaub', part:'teil2', level:'A2',
    title:'Was machen Sie gerne im Urlaub?', theme:'urlaub',
    promptText:'Was machen Sie gerne im Urlaub?',
    corners:['Mit wem','Wohin','Wie reisen','In welchem Monat'],
    modelSentences:['Im Urlaub möchte ich mich erholen und etwas Neues sehen.','Am liebsten reise ich mit meiner Familie oder mit guten Freunden.','Dann macht die Reise mehr Spaß, weil man Erlebnisse teilen kann.','Besonders gern fahre ich in die Berge oder ans Meer.','Dort kann man entweder wandern oder einfach entspannen.','Meistens reise ich mit dem Zug, weil das billiger und bequemer ist.','Wenn das Ziel weit weg ist, fliege ich manchmal auch mit dem Flugzeug.','Am liebsten mache ich im Sommer Urlaub, besonders im Juli oder August.','Dann ist das Wetter oft schön, und man kann viel draußen machen.','Im Winter finde ich Urlaub auch schön, wenn man Ski fahren möchte.','Wichtig ist für mich, dass ich im Urlaub nicht an die Arbeit denken muss.','Dann kann ich wirklich abschalten und neue Kraft sammeln.'],
    cueSetId:'cue_teil2_urlaub_v1', cueDimensions:['people','destination','transport','month'], estimatedDifficulty:'core', expectedAnswerLength:'long', source:'manual_v2', sourceDatasetVersion:'a2_exam_dataset_v2', active:true
  },
  {
    topicId:'t2_plaene', part:'teil2', level:'A2',
    title:'Was sind Ihre Pläne?', theme:'zukunft',
    promptText:'Was sind Ihre Pläne?',
    corners:['Weiter lernen','Beruf','Familie','Andere Pläne'],
    modelSentences:['Ich habe mehrere Pläne für die Zukunft.','Zuerst möchte ich weiter lernen, weil gute Ausbildung für mich sehr wichtig ist.','Im Moment lerne ich Deutsch, damit ich später bessere Möglichkeiten habe.','Beruflich möchte ich einen sicheren und interessanten Job finden.','Ich wünsche mir eine Arbeit, bei der ich mich weiterentwickeln kann.','Vielleicht arbeite ich später in Deutschland oder in einem internationalen Umfeld.','Für meine Familie habe ich im Moment noch keine festen Pläne.','Zuerst möchte ich beruflich etwas erreichen.','Später hätte ich aber gern eine eigene Familie.','Außerdem möchte ich viel reisen und neue Orte kennenlernen.','Ich will auch finanziell unabhängiger werden und vernünftig sparen.','Insgesamt versuche ich, Schritt für Schritt an meine Ziele zu kommen.'],
    cueSetId:'cue_teil2_daily_v1', cueDimensions:['learning','career','family','other'], estimatedDifficulty:'core', expectedAnswerLength:'long', source:'manual_v2', sourceDatasetVersion:'a2_exam_dataset_v2', active:true
  },
  {
    topicId:'t2_fruehstueck', part:'teil2', level:'A2',
    title:'Ihr Frühstück', theme:'essen',
    promptText:'Erzählen Sie über Ihr Frühstück.',
    corners:['Wann','Mit wem','Was gern','Wo am liebsten'],
    modelSentences:['Mein Frühstück ist für mich eine wichtige Mahlzeit.','Normalerweise frühstücke ich morgens zwischen sechs und sieben Uhr.','Unter der Woche frühstücke ich oft schnell, weil ich zur Arbeit oder zum Kurs muss.','Am Wochenende nehme ich mir dafür mehr Zeit.','Dann frühstücke ich gern mit meiner Familie.','Am liebsten esse ich Brot oder Brötchen mit Butter, Marmelade oder Käse.','Dazu trinke ich meistens Tee, Kaffee oder manchmal auch Saft.','Wenn ich gesund essen möchte, nehme ich zusätzlich Obst oder ein Ei.','Am liebsten frühstücke ich zu Hause, weil es dort ruhig und gemütlich ist.','Manchmal gehe ich aber auch mit Freunden in eine Bäckerei.','Dort schmeckt das Frühstück anders, aber auch sehr gut.','Ein gutes Frühstück ist für mich wichtig, weil ich dann besser in den Tag starte.'],
    cueSetId:'cue_teil2_daily_v1', cueDimensions:['time','people','food','place'], estimatedDifficulty:'core', expectedAnswerLength:'long', source:'manual_v2', sourceDatasetVersion:'a2_exam_dataset_v2', active:true
  },
  {
    topicId:'t2_traumwohnung', part:'teil2', level:'A2',
    title:'Ihre Traumwohnung', theme:'wohnen',
    promptText:'Beschreiben Sie Ihre Traumwohnung.',
    corners:['Wo?','Mit wem zusammen?','Miete?','Größe?'],
    modelSentences:['Meine Traumwohnung sollte modern, hell und ruhig sein.','Am liebsten wäre sie in der Nähe einer Stadt, aber nicht direkt im lauten Zentrum.','So hätte ich gute Verbindungen und trotzdem mehr Ruhe.','Ich möchte später gern mit meinem Partner oder meiner Familie zusammen wohnen.','Allein wohnen ist praktisch, aber zusammen wohnen finde ich schöner.','Die Wohnung sollte mindestens zwei oder drei Zimmer haben.','Wichtig sind für mich große Fenster, damit viel Licht hereinkommt.','Außerdem hätte ich gern einen Balkon oder einen kleinen Garten.','Die Miete sollte natürlich nicht zu hoch sein.','Ich finde es besser, wenn eine Wohnung schön und trotzdem bezahlbar ist.','Wenn ich genug Geld hätte, würde ich gern in einer größeren Wohnung leben.','Meine Traumwohnung muss also nicht luxuriös sein, aber sie soll gemütlich und praktisch sein.'],
    cueSetId:'cue_teil2_daily_v1', cueDimensions:['location','people','rent','size'], estimatedDifficulty:'core', expectedAnswerLength:'long', source:'manual_v2', sourceDatasetVersion:'a2_exam_dataset_v2', active:true
  },
  {
    topicId:'t2_nach_arbeit', part:'teil2', level:'A2',
    title:'Was machen Sie oft nach der Arbeit?', theme:'alltag',
    promptText:'Was machen Sie oft nach der Arbeit?',
    corners:['Freunde treffen','Mit ihrer Familie essen','Haushalt','Hobby'],
    modelSentences:['Nach der Arbeit brauche ich zuerst ein bisschen Ruhe.','Wenn ich nach Hause komme, esse ich oft etwas oder trinke einen Tee.','Danach erledige ich manchmal meinen Haushalt.','Ich räume mein Zimmer auf oder koche für den Abend.','Wenn ich noch Energie habe, treffe ich mich mit Freunden.','Dann gehen wir spazieren, ins Kino oder trinken zusammen etwas.','Oft esse ich am Abend auch mit meiner Familie.','Das ist für mich schön, weil wir dann endlich Zeit miteinander haben.','Außerdem versuche ich, Platz für meine Hobbys zu haben.','Ich lese, höre Musik oder mache ein bisschen Sport.','Wenn der Tag sehr anstrengend war, bleibe ich lieber zu Hause.','So finde ich nach der Arbeit einen guten Ausgleich zwischen Pflicht und Freizeit.'],
    cueSetId:'cue_teil2_daily_v1', cueDimensions:['friends','family','housework','hobby'], estimatedDifficulty:'core', expectedAnswerLength:'long', source:'manual_v2', sourceDatasetVersion:'a2_exam_dataset_v2', active:true
  },
  {
    topicId:'t2_draussen', part:'teil2', level:'A2',
    title:'Was machen Sie gern draußen?', theme:'freizeit',
    promptText:'Was machen Sie gern draußen?',
    corners:['Grillen','Im Park','Mit dem Fahrrad','Schwimmbad'],
    modelSentences:['Draußen mache ich besonders gern Dinge, bei denen ich mich bewegen kann.','Wenn das Wetter schön ist, gehe ich gern in den Park.','Dort kann man spazieren, sitzen oder einfach die frische Luft genießen.','Mit Freunden grille ich im Sommer manchmal im Garten oder im Park.','Das macht Spaß, weil man zusammen essen und lange reden kann.','Außerdem fahre ich gern Fahrrad.','So bin ich aktiv und komme schnell von einem Ort zum anderen.','Am Wochenende mache ich manchmal sogar einen kleinen Fahrradausflug.','Ins Schwimmbad gehe ich auch ab und zu, besonders im Sommer.','Schwimmen ist gesund und entspannt mich.','Ich finde es wichtig, möglichst viel Zeit draußen zu verbringen.','Deshalb nutze ich gutes Wetter immer, wenn ich die Möglichkeit dazu habe.'],
    cueSetId:'cue_teil2_daily_v1', cueDimensions:['grill','park','cycling','swimming'], estimatedDifficulty:'core', expectedAnswerLength:'long', source:'manual_v2', sourceDatasetVersion:'a2_exam_dataset_v2', active:true
  },
  {
    topicId:'t2_deutschkurs', part:'teil2', level:'A2',
    title:'Was finden Sie im Deutschkurs interessant?', theme:'lernen',
    promptText:'Was finden Sie im Deutschkurs interessant? Was gefällt Ihnen nicht so gut?',
    corners:['Kursbuch','Lehrer','Texte/Übungen','Freunde'],
    modelSentences:['Im Deutschkurs finde ich vieles interessant, besonders wenn ich aktiv sprechen kann.','Ich mag es, neue Wörter zu lernen und sie sofort zu benutzen.','Das Kursbuch ist hilfreich, weil es Struktur gibt und viele Themen erklärt.','Besonders gut finde ich Übungen, bei denen man sprechen und schreiben muss.','Unser Lehrer ist für mich auch sehr wichtig.','Wenn der Lehrer gut erklärt und geduldig ist, lerne ich deutlich besser.','Außerdem habe ich im Kurs neue Freunde kennengelernt.','Mit ihnen kann ich zusammen lernen und Hausaufgaben machen.','Nicht so gut gefallen mir manchmal sehr lange oder langweilige Texte.','Dann verliere ich schnell die Konzentration.','Auch zu viele Hausaufgaben auf einmal finde ich anstrengend.','Trotzdem gefällt mir der Deutschkurs insgesamt, weil ich jeden Tag Fortschritte mache.'],
    cueSetId:'cue_teil2_daily_v1', cueDimensions:['textbook','teacher','exercises','friends'], estimatedDifficulty:'core', expectedAnswerLength:'long', source:'manual_v2', sourceDatasetVersion:'a2_exam_dataset_v2', active:true
  },
  {
    topicId:'t2_urlaub_wunsch', part:'teil2', level:'A2',
    title:'Was möchten Sie am liebsten im Urlaub machen?', theme:'urlaub',
    promptText:'Was möchten Sie am liebsten im Urlaub machen?',
    corners:['Meer','Wandern','Sprachkurs','Mit wem'],
    modelSentences:['Im Urlaub möchte ich vor allem etwas machen, was mir wirklich Freude bringt.','Am liebsten fahre ich ans Meer, weil ich Wasser und Sonne sehr mag.','Dort kann ich spazieren gehen, schwimmen oder einfach entspannen.','Wandern finde ich ebenfalls schön, besonders wenn ich in den Bergen bin.','Dann genieße ich die Natur und kann gut abschalten.','Mit meiner Familie oder mit Freunden macht Urlaub natürlich mehr Spaß.','Ich reise ungern ganz allein, weil gemeinsame Erlebnisse schöner sind.','Einen Sprachkurs würde ich im Urlaub nur machen, wenn ich genug Zeit hätte.','Normalerweise möchte ich im Urlaub eher frei sein und nicht zu viel lernen.','Trotzdem kann ein kurzer Kurs interessant sein, wenn man ein Land besser kennenlernen will.','Wichtig ist für mich, dass Urlaub abwechslungsreich und entspannt ist.','Dann komme ich glücklich und mit neuer Energie zurück.'],
    cueSetId:'cue_teil2_urlaub_v1', cueDimensions:['sea','hiking','course','people'], estimatedDifficulty:'core', expectedAnswerLength:'long', source:'manual_v2', sourceDatasetVersion:'a2_exam_dataset_v2', active:true
  },
  {
    topicId:'t2_freunde_aktivitaeten', part:'teil2', level:'A2',
    title:'Was machen Sie gern mit Ihren Freunden zusammen?', theme:'freunde',
    promptText:'Was machen Sie gern mit Ihren Freunden zusammen?',
    corners:['Computerspiele','Sport/Hobbys','Ausflüge/Wandern','Am Wochenende'],
    modelSentences:['Mit meinen Freunden mache ich am liebsten Dinge, bei denen wir zusammen Spaß haben.','Am Wochenende treffen wir uns oft, weil dann alle mehr Zeit haben.','Manchmal spielen wir zusammen Sport, zum Beispiel Fußball, Tennis oder Cricket.','Das ist gut, weil man aktiv ist und gleichzeitig Zeit miteinander verbringt.','Wenn das Wetter schön ist, machen wir gern einen Ausflug.','Wir fahren mit dem Fahrrad, gehen zum See oder wandern in die Berge.','Abends spielen wir manchmal auch Computerspiele.','Das machen wir besonders dann, wenn das Wetter schlecht ist.','Außerdem gehen wir zusammen ins Kino oder essen in der Stadt.','Mit guten Freunden wird fast jede Aktivität interessanter.','Mir gefällt besonders, dass wir viel reden und zusammen lachen.','Deshalb ist die Zeit mit meinen Freunden für mich sehr wichtig.'],
    cueSetId:'cue_teil2_daily_v1', cueDimensions:['games','sport','trips','weekend'], estimatedDifficulty:'core', expectedAnswerLength:'long', source:'manual_v2', sourceDatasetVersion:'a2_exam_dataset_v2', active:true
  },
  {
    topicId:'t2_wohnen_wie', part:'teil2', level:'A2',
    title:'Wie möchten Sie gern wohnen?', theme:'wohnen',
    promptText:'Wie möchten Sie gern wohnen?',
    corners:['Wie viele Zimmer?','Großstadt?','Allein?','Haustiere?'],
    modelSentences:['Später möchte ich gern in einer ruhigen und praktischen Wohnung leben.','Zwei oder drei Zimmer wären für mich ideal.','Dann hätte ich genug Platz zum Wohnen, Arbeiten und Entspannen.','Ich möchte nicht mitten im größten Stadtzentrum wohnen.','Eine Wohnung am Rand einer Stadt wäre für mich besser.','So hätte ich Ruhe, aber trotzdem gute Verbindungen.','Allein wohnen hat Vorteile, weil man mehr Freiheit hat.','Trotzdem könnte ich mir auch vorstellen, mit meinem Partner zusammen zu wohnen.','Ein Haustier hätte ich später vielleicht auch gern.','Besonders ein Hund gefällt mir, wenn genug Platz da ist.','Wichtig ist für mich, dass die Wohnung hell, sauber und nicht zu teuer ist.','Dann würde ich mich dort wirklich wohlfühlen.'],
    cueSetId:'cue_teil2_daily_v1', cueDimensions:['rooms','city','alone','pets'], estimatedDifficulty:'core', expectedAnswerLength:'long', source:'manual_v2', sourceDatasetVersion:'a2_exam_dataset_v2', active:true
  },
  {
    topicId:'t2_abend_nach_hause', part:'teil2', level:'A2',
    title:'Wie sieht Ihr Tag aus, wenn Sie abends nach Hause kommen?', theme:'alltag',
    promptText:'Wie sieht Ihr Tag aus, wenn Sie abends nach Hause kommen?',
    corners:['kochen','Familie','Training','Hobbys'],
    modelSentences:['Wenn ich abends nach Hause komme, bin ich zuerst etwas müde.','Trotzdem versuche ich, meinen Abend sinnvoll zu gestalten.','Oft koche ich zuerst etwas, weil ich warmes Essen am Abend mag.','Wenn meine Familie zu Hause ist, essen wir meistens zusammen.','Dabei sprechen wir über den Tag und entspannen uns ein bisschen.','An manchen Tagen habe ich abends Training oder mache Sport.','Dann gehe ich zum Verein oder trainiere kurz zu Hause.','Wenn ich kein Training habe, kümmere ich mich um meine Hobbys.','Ich höre Musik, lese etwas oder sehe eine Serie.','Manchmal räume ich auch noch schnell etwas im Haushalt auf.','Später dusche ich, bereite mich auf den nächsten Tag vor und gehe schlafen.','So endet mein Tag meistens ruhig und organisiert.'],
    cueSetId:'cue_teil2_daily_v1', cueDimensions:['cooking','family','training','hobbies'], estimatedDifficulty:'core', expectedAnswerLength:'long', source:'manual_v2', sourceDatasetVersion:'a2_exam_dataset_v2', active:true
  },
  {
    topicId:'t2_schule', part:'teil2', level:'A2',
    title:'Was findest du in der Schule interessant?', theme:'lernen',
    promptText:'Was findest du in der Schule interessant? Was gefällt dir nicht so gut?',
    corners:['Lieblingsfach','Lehrer','Sport','Freunde'],
    modelSentences:['In der Schule finde ich besonders Fächer interessant, in denen ich aktiv mitmachen kann.','Mein Lieblingsfach ist zum Beispiel Sport, weil ich mich gern bewege.','Auch Sprachen oder praktische Fächer gefallen mir oft gut.','Ein guter Lehrer macht für mich einen großen Unterschied.','Wenn der Lehrer motiviert ist und gut erklärt, macht der Unterricht mehr Spaß.','Außerdem finde ich es schön, dass man in der Schule Freunde treffen kann.','Mit Freunden lernt man leichter und der Tag ist nicht so langweilig.','Nicht so gut gefallen mir sehr lange oder monotone Stunden.','Wenn man nur zuhören muss, verliere ich schnell die Konzentration.','Zu viele Hausaufgaben finde ich ebenfalls anstrengend.','Trotzdem ist Schule wichtig, weil man dort viel für die Zukunft lernt.','Deshalb versuche ich, das Positive zu sehen und aktiv mitzumachen.'],
    cueSetId:'cue_teil2_daily_v1', cueDimensions:['subject','teacher','sport','friends'], estimatedDifficulty:'core', expectedAnswerLength:'long', source:'manual_v2', sourceDatasetVersion:'a2_exam_dataset_v2', active:true
  },
  {
    topicId:'t2_gesundheit', part:'teil2', level:'A2',
    title:'Was tun Sie für Ihre Gesundheit?', theme:'gesundheit',
    promptText:'Was tun Sie für Ihre Gesundheit?',
    corners:['Sport','Arzt','Ernährung','Erholung'],
    modelSentences:['Für meine Gesundheit versuche ich regelmäßig etwas zu tun.','Ich mache Sport, weil Bewegung für Körper und Geist wichtig ist.','Mehrmals pro Woche gehe ich spazieren, joggen oder spiele ein Spiel im Team.','Außerdem achte ich auf meine Ernährung.','Ich esse möglichst oft Gemüse, Obst und nicht zu viel Fast Food.','Genug Wasser zu trinken finde ich ebenfalls sehr wichtig.','Zum Arzt gehe ich nur, wenn ich Beschwerden habe oder etwas kontrollieren lassen muss.','Ich finde Vorsorge trotzdem sinnvoll.','Ebenso wichtig ist für mich Erholung.','Wenn ich zu wenig schlafe oder zu viel Stress habe, fühle ich mich schnell schlecht.','Deshalb versuche ich, am Abend Ruhe zu finden und genug zu schlafen.','Gesundheit bedeutet für mich also Bewegung, gutes Essen und ausreichend Erholung.'],
    cueSetId:'cue_teil2_daily_v1', cueDimensions:['sport','doctor','nutrition','rest'], estimatedDifficulty:'core', expectedAnswerLength:'long', source:'manual_v2', sourceDatasetVersion:'a2_exam_dataset_v2', active:true
  },
  {
    topicId:'t2_arbeitsplatz', part:'teil2', level:'A2',
    title:'Was machen Sie an Ihrem Arbeitsplatz?', theme:'arbeit',
    promptText:'Was machen Sie an Ihrem Arbeitsplatz?',
    corners:['Wo?','Arbeitszeit?','Aufgaben?','Kollegen'],
    modelSentences:['Ich arbeite an einem Ort, an dem ich täglich verschiedene Aufgaben habe.','Mein Arbeitsplatz ist interessant, weil kein Tag genau wie der andere ist.','Normalerweise beginne ich am Morgen und arbeite bis zum Nachmittag oder Abend.','Manchmal muss ich auch länger bleiben, wenn viel zu tun ist.','Zu meinen Aufgaben gehören je nach Beruf unterschiedliche Dinge.','Ich spreche mit Kollegen oder Kunden, erledige meine Arbeit und löse kleine Probleme.','Wichtig ist, dass ich organisiert arbeite und meine Aufgaben pünktlich schaffe.','Mit meinen Kollegen verstehe ich mich zum Glück gut.','Wir helfen uns gegenseitig, wenn jemand Unterstützung braucht.','Eine freundliche Atmosphäre am Arbeitsplatz ist für mich sehr wichtig.','Natürlich gibt es manchmal stressige Tage, aber das gehört dazu.','Insgesamt mag ich meinen Arbeitsplatz, weil ich dort viel lernen kann.'],
    cueSetId:'cue_teil2_daily_v1', cueDimensions:['location','hours','tasks','colleagues'], estimatedDifficulty:'core', expectedAnswerLength:'long', source:'manual_v2', sourceDatasetVersion:'a2_exam_dataset_v2', active:true
  },
  {
    topicId:'t2_fernsehen', part:'teil2', level:'A2',
    title:'Fernsehgewohnheiten', theme:'medien',
    promptText:'Erzählen Sie über Ihre Fernsehgewohnheiten.',
    corners:['Mit wem?','Wann?','Wie lange?','Was?'],
    modelSentences:['Fernsehen gehört für mich eher zum Abend als zum Tag.','Meistens sehe ich nach der Arbeit oder nach dem Lernen fern.','Unter der Woche mache ich das nicht sehr lange, vielleicht ein oder zwei Stunden.','Am Wochenende sehe ich manchmal länger fern.','Oft schaue ich mit meiner Familie oder mit Freunden.','Manchmal sehe ich aber auch allein fern, wenn ich Ruhe haben möchte.','Am liebsten schaue ich Filme, Serien oder Sportsendungen.','Nachrichten sehe ich auch, weil ich informiert bleiben möchte.','Zu viel Fernsehen finde ich allerdings nicht gut.','Wenn man zu lange vor dem Bildschirm sitzt, bewegt man sich zu wenig.','Außerdem kann Fernsehen Zeit kosten, die man für wichtigere Dinge braucht.','Deshalb versuche ich, bewusst fernzusehen und nicht einfach planlos.'],
    cueSetId:'cue_teil2_daily_v1', cueDimensions:['people','time','duration','content'], estimatedDifficulty:'core', expectedAnswerLength:'long', source:'manual_v2', sourceDatasetVersion:'a2_exam_dataset_v2', active:true
  },
  {
    topicId:'t2_land_wohnen', part:'teil2', level:'A2',
    title:'Wohnen auf dem Land', theme:'wohnen',
    promptText:'Erzählen Sie über das Wohnen auf dem Land.',
    corners:['Öffentliche Verkehrsmittel?','Ausgehen?','Einkaufsmöglichkeiten?','Kontakte mit anderen Menschen?'],
    modelSentences:['Wohnen auf dem Land hat für mich sowohl Vorteile als auch Nachteile.','Ein großer Vorteil ist die Ruhe.','Man hat oft mehr Natur, weniger Verkehr und weniger Stress als in der Stadt.','Allerdings sind öffentliche Verkehrsmittel auf dem Land nicht immer so gut.','Busse oder Bahnen fahren oft seltener, und das ist manchmal unpraktisch.','Auch beim Ausgehen gibt es meist weniger Möglichkeiten.','Es gibt nicht überall Kinos, Clubs oder viele Restaurants.','Beim Einkaufen ist es ähnlich, weil größere Geschäfte oft weiter weg sind.','Trotzdem finde ich das Leben auf dem Land angenehm, wenn man Ruhe mag.','Oft kennen sich die Menschen dort besser und haben mehr Kontakt miteinander.','Das gefällt mir, weil die Atmosphäre persönlicher ist.','Ich könnte mir gut vorstellen, auf dem Land zu wohnen, wenn die Verbindung zur Stadt gut ist.'],
    cueSetId:'cue_teil2_daily_v1', cueDimensions:['transport','going_out','shopping','social'], estimatedDifficulty:'core', expectedAnswerLength:'long', source:'manual_v2', sourceDatasetVersion:'a2_exam_dataset_v2', active:true
  },
  {
    topicId:'t2_freunde_oft', part:'teil2', level:'A2',
    title:'Was machen Sie oft mit Ihren Freunden?', theme:'freunde',
    promptText:'Was machen Sie oft mit Ihren Freunden?',
    corners:['Ins Kino gehen?','Ausgehen?','Hobbys?','Essen?'],
    modelSentences:['Mit meinen Freunden treffe ich mich meistens am Wochenende.','Dann haben wir mehr Zeit und können etwas zusammen unternehmen.','Oft gehen wir ins Kino, wenn ein interessanter Film läuft.','Manchmal gehen wir auch einfach in die Stadt und verbringen dort den Abend.','Wir sprechen viel, lachen zusammen und entspannen uns.','Hobbys teilen wir ebenfalls, zum Beispiel Sport oder Musik.','Ab und zu spielen wir Fußball oder gehen schwimmen.','Wenn wir keine Lust auf Sport haben, essen wir zusammen.','Dann kochen wir etwas oder gehen in ein Restaurant.','Gemeinsames Essen macht immer gute Stimmung.','Mir gefällt besonders, dass man mit Freunden offen reden kann.','Deshalb ist die Zeit mit meinen Freunden für mich ein wichtiger Teil meines Lebens.'],
    cueSetId:'cue_teil2_daily_v1', cueDimensions:['cinema','going_out','hobbies','eating'], estimatedDifficulty:'core', expectedAnswerLength:'long', source:'manual_v2', sourceDatasetVersion:'a2_exam_dataset_v2', active:true
  },
  {
    topicId:'t2_tagesablauf', part:'teil2', level:'A2',
    title:'Tagesablauf', theme:'alltag',
    promptText:'Beschreiben Sie Ihren Tagesablauf.',
    corners:['Morgen','Arbeit/Schule','Essen','Abend'],
    modelSentences:['Mein Tagesablauf ist unter der Woche ziemlich regelmäßig.','Morgens stehe ich früh auf und mache mich zuerst fertig.','Danach frühstücke ich, damit ich gut in den Tag starte.','Anschließend gehe ich zur Arbeit, zur Uni oder zum Sprachkurs.','Dort bin ich mehrere Stunden beschäftigt und mache zwischendurch eine Pause.','Mittags esse ich etwas Leichtes, zum Beispiel in der Mensa oder zu Hause.','Am Nachmittag erledige ich weitere Aufgaben oder lerne noch etwas.','Wenn ich nach Hause komme, ruhe ich mich kurz aus.','Am Abend koche ich oft oder esse mit meiner Familie.','Danach höre ich Musik, sehe fern oder bereite mich auf den nächsten Tag vor.','Ich gehe nicht zu spät ins Bett, weil ich morgens wieder fit sein möchte.','So ist mein Tag meistens gut organisiert und nicht zu chaotisch.'],
    cueSetId:'cue_teil2_daily_v1', cueDimensions:['morning','work','food','evening'], estimatedDifficulty:'core', expectedAnswerLength:'long', source:'manual_v2', sourceDatasetVersion:'a2_exam_dataset_v2', active:true
  },
  {
    topicId:'t2_sonntag', part:'teil2', level:'A2',
    title:'Was machen Sie am Sonntag?', theme:'freizeit',
    promptText:'Was machen Sie am Sonntag?',
    corners:['Freunde besuchen?','Hobbys?','Lange schlafen?','Fernsehen?'],
    modelSentences:['Der Sonntag ist für mich ein ruhiger und angenehmer Tag.','Normalerweise schlafe ich etwas länger, weil ich keinen Stress habe.','Nach dem Frühstück plane ich, was ich an dem Tag machen möchte.','Manchmal besuche ich Freunde oder Verwandte.','Dann trinken wir Kaffee, reden viel oder gehen zusammen spazieren.','Wenn ich zu Hause bleibe, kümmere ich mich um meine Hobbys.','Ich lese, höre Musik oder sehe einen Film.','Sport mache ich am Sonntag auch manchmal, wenn ich genug Energie habe.','Am Abend sehe ich oft mit meiner Familie fern.','Sonntags gefällt mir besonders, dass alles etwas ruhiger ist.','So kann ich mich gut erholen und mich auf die neue Woche vorbereiten.','Deshalb ist der Sonntag einer meiner Lieblingstage.'],
    cueSetId:'cue_teil2_daily_v1', cueDimensions:['friends','hobbies','sleep','tv'], estimatedDifficulty:'core', expectedAnswerLength:'long', source:'manual_v2', sourceDatasetVersion:'a2_exam_dataset_v2', active:true
  },
];
export const A2_EXAM_CUE_SETS = {
  cue_teil2_daily_v1: { cueSetId:'cue_teil2_daily_v1', label:'Teil 2 daily life cues', dimensions:[{ key:'activity', label:'Was?' },{ key:'place', label:'Wo?' },{ key:'people', label:'Mit wem?' },{ key:'frequency', label:'Wie oft?' },{ key:'reason', label:'Warum?' }] },
  cue_teil2_urlaub_v1: { cueSetId:'cue_teil2_urlaub_v1', label:'Teil 2 holiday cues', dimensions:[{ key:'activity', label:'Was?' },{ key:'place', label:'Wo?' },{ key:'people', label:'Mit wem?' },{ key:'reason', label:'Warum?' }] }
};
export const A2_EXAM_ANSWER_BLUEPRINTS = { teil1_freizeit_hobbys:{ topicId:'teil1_freizeit_hobbys' }, teil2_urlaub:{ topicId:'teil2_urlaub' } };
export const A2_EXAM_SCORING_PROFILES = {
  a2_exam_teil1_v1:{ examProfile:'a2_exam_teil1_v1', part:'teil1', passThresholds:{ safe_pass:60, borderline_pass:50, at_risk:40 } },
  a2_exam_teil2_v1:{ examProfile:'a2_exam_teil2_v1', part:'teil2', passThresholds:{ safe_pass:60, borderline_pass:50, at_risk:40 } },
  a2_exam_teil3_v1:{ examProfile:'a2_exam_teil3_v1', part:'teil3', passThresholds:{ safe_pass:60, borderline_pass:50, at_risk:40 } },
  a2_exam_full_v1:{ examProfile:'a2_exam_full_v1', part:'full_mock', passThresholds:{ safe_pass:60, borderline_pass:50, at_risk:40 } },
};
export const EXAM_DEFAULT_PASS_THRESHOLDS = { safe_pass:60, borderline_pass:50, at_risk:40 };
export const EXAM_CUE_KEYWORD_GROUPS = { activity:['machen','spiele','lernen','lese','koche','fahre','gehe'], place:['in','im','zu','bei','nach','wo','wohin'], people:['mit','freund','familie','eltern'], frequency:['immer','oft','manchmal','selten','nie','meistens'], reason:['weil','denn','darum','möchte','will','mag'] };
